import type { CollectionConfig } from 'payload';

import { membershipGroupIds } from '../access/helpers';
import { getOrCreateCurrentSeason } from '../lib/season';
import { eligiblePlayerIds, allGroupMemberIds, membershipStrengthByUser, seasonGoalsByUser, buildLineupSummaries } from '../lib/lineup';
import { recomputeStatsForPlayers } from '../lib/stats';
import { polyIds, polyRef, polyRefs, polyValue } from '../lib/polymorphic';

/**
 * "Termine" — implementation-plan.md §3.1 (schema), §3.2 (`/fixtures/weekly`
 * hook), §3.4 (access), §3.6 (API surface).
 */
export const Fixtures: CollectionConfig = {
  slug: 'fixtures',
  admin: { useAsTitle: 'date' },
  access: {
    read: async ({ req }) => {
      if (!req.user) return false;
      const ids = await membershipGroupIds(req);
      if (ids.length === 0) return false;
      return { group: { in: ids } };
    },
    create: async ({ req }) => {
      if (!req.user) return false;
      const ids = await membershipGroupIds(req, { roles: ['admin', 'organizer'] });
      return ids.length > 0;
    },
    update: async ({ req }) => {
      if (!req.user) return false;
      const ids = await membershipGroupIds(req, { roles: ['admin', 'organizer'] });
      if (ids.length === 0) return false;
      return { group: { in: ids } };
    },
    delete: async ({ req }) => {
      if (!req.user) return false;
      const ids = await membershipGroupIds(req, { roles: ['admin', 'organizer'] });
      if (ids.length === 0) return false;
      return { group: { in: ids } };
    },
  },
  hooks: {
    beforeChange: [
      async ({ req, data, operation }) => {
        if (operation === 'create') {
          if (req.user) data.createdBy = req.user.id;
          if (!data.season && data.group) {
            const groupId = typeof data.group === 'object' ? data.group.id : data.group;
            const season = await getOrCreateCurrentSeason(req.payload, groupId);
            data.season = season.id;
          }
        }
        return data;
      },
    ],
    afterRead: [
      // Attaches a computed, non-persisted `rsvpYesCount` to every fixture
      // read (list + single) so Termine rows/the Start card can show
      // attendance without an extra round trip per row (§4.5). Not gated
      // behind `features.rsvp` here — the *app* hides it when the flag is
      // off, same as every other rsvp-derived UI (§3.8/§4.6).
      async ({ doc, req }) => {
        const { totalDocs } = await req.payload.count({
          collection: 'rsvps',
          where: { fixture: { equals: doc.id }, status: { equals: 'yes' } },
          overrideAccess: true,
        });
        return { ...doc, rsvpYesCount: totalDocs };
      },
    ],
  },
  endpoints: [
    {
      // §3.2/§3.6: base fixture + the next 7 weekly occurrences, one shared
      // `repeatGroupId` — mirrors the prototype's "wöchentlich wiederholen"
      // toggle, which the app calls this instead of the plain create for.
      path: '/weekly',
      method: 'post',
      handler: async (req) => {
        if (!req.user) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        let body: Record<string, unknown> = {};
        try {
          body = (await req.json?.()) ?? {};
        } catch {
          // handled by the validation below
        }

        const group = typeof body.group === 'string' ? body.group : '';
        const date = typeof body.date === 'string' ? body.date : '';
        const time = typeof body.time === 'string' ? body.time : '';
        const hall = typeof body.hall === 'string' ? body.hall : undefined;

        if (!group || !date || !time) {
          return Response.json({ error: 'group, date and time are required' }, { status: 400 });
        }

        const adminGroupIds = await membershipGroupIds(req, { roles: ['admin', 'organizer'] });
        if (!adminGroupIds.map(String).includes(String(group))) {
          return Response.json({ error: 'Forbidden' }, { status: 403 });
        }

        const season = await getOrCreateCurrentSeason(req.payload, group);
        const repeatGroupId = `rg_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
        const baseDate = new Date(date);

        const fixtures = [];
        for (let i = 0; i < 8; i += 1) {
          const occurrenceDate = new Date(baseDate);
          occurrenceDate.setUTCDate(occurrenceDate.getUTCDate() + i * 7);
          // eslint-disable-next-line no-await-in-loop -- each create must run
          // through the same beforeChange hook in sequence, not in parallel,
          // to keep the shared `season` lookup consistent.
          const fixture = await req.payload.create({
            collection: 'fixtures',
            data: {
              group,
              season: season.id,
              date: occurrenceDate.toISOString(),
              time,
              hall,
              status: 'upcoming',
              repeatGroupId,
              createdBy: req.user.id,
            },
            overrideAccess: true,
          });
          fixtures.push(fixture);
        }

        return Response.json({ docs: fixtures }, { status: 201 });
      },
    },
    {
      // §3.6: set MY OWN yes/no for this fixture (upsert — unique index on
      // (fixture, user) makes a duplicate impossible even under a race).
      // 403 if `features.rsvp` is off for the group (§3.8).
      path: '/:id/rsvp',
      method: 'post',
      handler: async (req) => {
        if (!req.user) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const fixtureId = req.routeParams?.id;
        if (typeof fixtureId !== 'string' && typeof fixtureId !== 'number') {
          return Response.json({ error: 'Invalid fixture id' }, { status: 400 });
        }

        let body: Record<string, unknown> = {};
        try {
          body = (await req.json?.()) ?? {};
        } catch {
          // handled by the validation below
        }
        const status = body.status === 'yes' || body.status === 'no' ? body.status : undefined;
        if (!status) {
          return Response.json({ error: 'status must be "yes" or "no"' }, { status: 400 });
        }

        const fixture = await req.payload.findByID({
          collection: 'fixtures',
          id: fixtureId,
          depth: 1,
          overrideAccess: true,
        });
        if (!fixture) {
          return Response.json({ error: 'Not found' }, { status: 404 });
        }

        const group = typeof fixture.group === 'object' && fixture.group !== null ? fixture.group : null;
        const groupId = group ? group.id : fixture.group;

        const myGroupIds = await membershipGroupIds(req);
        if (!myGroupIds.map(String).includes(String(groupId))) {
          return Response.json({ error: 'Forbidden' }, { status: 403 });
        }

        if (!group?.features?.rsvp) {
          return Response.json({ error: 'RSVP is disabled for this group' }, { status: 403 });
        }

        const existing = await req.payload.find({
          collection: 'rsvps',
          where: { fixture: { equals: fixtureId }, user: { equals: req.user.id } },
          limit: 1,
          overrideAccess: true,
        });

        const respondedAt = new Date().toISOString();
        const rsvp = existing.docs[0]
          ? await req.payload.update({
              collection: 'rsvps',
              id: existing.docs[0].id,
              data: { status, respondedAt },
              overrideAccess: true,
            })
          : await req.payload.create({
              collection: 'rsvps',
              data: { fixture: fixtureId, user: req.user.id, status, respondedAt },
              overrideAccess: true,
            });

        const { totalDocs: yesCount } = await req.payload.count({
          collection: 'rsvps',
          where: { fixture: { equals: fixtureId }, status: { equals: 'yes' } },
          overrideAccess: true,
        });

        return Response.json({ rsvp, yesCount }, { status: 200 });
      },
    },
    {
      // §3.6: attendance count + MY OWN status for one fixture — the
      // read-side counterpart to `/rsvp` above. Doesn't need Rsvps.access
      // to allow reading other members' rows (see the note on Rsvps.ts).
      path: '/:id/summary',
      method: 'get',
      handler: async (req) => {
        if (!req.user) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const fixtureId = req.routeParams?.id;
        if (typeof fixtureId !== 'string' && typeof fixtureId !== 'number') {
          return Response.json({ error: 'Invalid fixture id' }, { status: 400 });
        }

        const fixture = await req.payload.findByID({
          collection: 'fixtures',
          id: fixtureId,
          depth: 0,
          overrideAccess: true,
        });
        if (!fixture) {
          return Response.json({ error: 'Not found' }, { status: 404 });
        }
        const groupId = typeof fixture.group === 'object' && fixture.group !== null ? fixture.group.id : fixture.group;

        const myGroupIds = await membershipGroupIds(req);
        if (!myGroupIds.map(String).includes(String(groupId))) {
          return Response.json({ error: 'Forbidden' }, { status: 403 });
        }

        const { totalDocs: yesCount } = await req.payload.count({
          collection: 'rsvps',
          where: { fixture: { equals: fixtureId }, status: { equals: 'yes' } },
          overrideAccess: true,
        });
        const mine = await req.payload.find({
          collection: 'rsvps',
          where: { fixture: { equals: fixtureId }, user: { equals: req.user.id } },
          limit: 1,
          overrideAccess: true,
        });

        return Response.json({ yesCount, myStatus: mine.docs[0]?.status ?? null }, { status: 200 });
      },
    },
    {
      // §3.6: red/green/pool for one fixture. Pool is defined per §3.8:
      // confirmed RSVPs when `features.rsvp` is on, every member otherwise.
      // Any group member may view team assignments (building/adjusting them
      // is restricted below, on the PATCH/auto-balance endpoints).
      //
      // Live lineups are `users`-only even though `lineups.redPlayers`/
      // `greenPlayers` are now the polymorphic `[users, legacyPlayers]`
      // relation (§3.1, phase 6) — a legacy player can never be part of a
      // live RSVP/membership pool, only an imported one. `polyIds()` still
      // reads correctly either way; it's used here purely because the field
      // shape changed, not because this endpoint deals with legacy players.
      path: '/:id/lineup',
      method: 'get',
      handler: async (req) => {
        if (!req.user) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const fixtureId = req.routeParams?.id;
        if (typeof fixtureId !== 'string' && typeof fixtureId !== 'number') {
          return Response.json({ error: 'Invalid fixture id' }, { status: 400 });
        }

        const fixture = await req.payload.findByID({
          collection: 'fixtures',
          id: fixtureId,
          depth: 1,
          overrideAccess: true,
        });
        if (!fixture) {
          return Response.json({ error: 'Not found' }, { status: 404 });
        }

        const group = typeof fixture.group === 'object' && fixture.group !== null ? fixture.group : null;
        const groupId = group ? group.id : fixture.group;

        const myGroupIds = await membershipGroupIds(req);
        if (!myGroupIds.map(String).includes(String(groupId))) {
          return Response.json({ error: 'Forbidden' }, { status: 403 });
        }

        const rsvpEnabled = Boolean(group?.features?.rsvp);
        const strengthEnabled = Boolean(group?.features?.strength);

        const eligibleIds = await eligiblePlayerIds(req.payload, groupId, fixtureId, rsvpEnabled);

        const existing = await req.payload.find({
          collection: 'lineups',
          where: { fixture: { equals: fixtureId } },
          limit: 1,
          depth: 0,
          overrideAccess: true,
        });
        const lineup = existing.docs[0];
        const redIds = lineup ? polyIds(lineup.redPlayers) : [];
        const greenIds = lineup ? polyIds(lineup.greenPlayers) : [];

        const strengthMap = strengthEnabled ? await membershipStrengthByUser(req.payload, groupId, eligibleIds) : null;

        const result = await buildLineupSummaries(req.payload, groupId, fixtureId, eligibleIds, redIds, greenIds, strengthMap);

        return Response.json(result, { status: 200 });
      },
    },
    {
      // §3.6/§4.5: manual assign/unassign — always available regardless of
      // flags. Admin/organizer only (§3.4: "edit lineups").
      path: '/:id/lineup',
      method: 'patch',
      handler: async (req) => {
        if (!req.user) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const fixtureId = req.routeParams?.id;
        if (typeof fixtureId !== 'string' && typeof fixtureId !== 'number') {
          return Response.json({ error: 'Invalid fixture id' }, { status: 400 });
        }

        let body: Record<string, unknown> = {};
        try {
          body = (await req.json?.()) ?? {};
        } catch {
          // handled by the validation below
        }
        const playerId = typeof body.playerId === 'string' || typeof body.playerId === 'number' ? body.playerId : undefined;
        const team = body.team === 'red' || body.team === 'green' || body.team === null ? body.team : undefined;
        if (playerId === undefined || team === undefined) {
          return Response.json({ error: 'playerId and team ("red" | "green" | null) are required' }, { status: 400 });
        }

        const fixture = await req.payload.findByID({
          collection: 'fixtures',
          id: fixtureId,
          depth: 1,
          overrideAccess: true,
        });
        if (!fixture) {
          return Response.json({ error: 'Not found' }, { status: 404 });
        }

        const group = typeof fixture.group === 'object' && fixture.group !== null ? fixture.group : null;
        const groupId = group ? group.id : fixture.group;

        const adminGroupIds = await membershipGroupIds(req, { roles: ['admin', 'organizer'] });
        if (!adminGroupIds.map(String).includes(String(groupId))) {
          return Response.json({ error: 'Forbidden' }, { status: 403 });
        }

        const rsvpEnabled = Boolean(group?.features?.rsvp);
        const eligibleIds = await eligiblePlayerIds(req.payload, groupId, fixtureId, rsvpEnabled);
        let finalEligibleIds = eligibleIds;

        if (!eligibleIds.map(String).includes(String(playerId))) {
          // Not currently "confirmed" (only reachable when `features.rsvp`
          // is on — with it off, `eligiblePlayerIds()` already returns
          // every member). This is the app's "Nicht dabei" list (§4.5):
          // assigning someone from there always means they're attending
          // now, so mark their RSVP `yes` as a side effect before
          // proceeding — unassigning (`team === null`) can never land here
          // in the first place, since only an already-assigned (and so
          // already-eligible) player can be unassigned. Still requires
          // them to actually belong to this fixture's group at all — this
          // isn't a way to assign an arbitrary user id.
          const memberIds = await allGroupMemberIds(req.payload, groupId);
          if (!memberIds.map(String).includes(String(playerId))) {
            return Response.json({ error: 'Player is not a member of this group' }, { status: 400 });
          }
          if (team === null) {
            return Response.json({ error: 'Player is not eligible for this fixture' }, { status: 400 });
          }

          const existingRsvp = await req.payload.find({
            collection: 'rsvps',
            where: { fixture: { equals: fixtureId }, user: { equals: playerId } },
            limit: 1,
            overrideAccess: true,
          });
          const respondedAt = new Date().toISOString();
          if (existingRsvp.docs[0]) {
            await req.payload.update({
              collection: 'rsvps',
              id: existingRsvp.docs[0].id,
              data: { status: 'yes', respondedAt },
              overrideAccess: true,
            });
          } else {
            await req.payload.create({
              collection: 'rsvps',
              data: { fixture: fixtureId, user: playerId, status: 'yes', respondedAt },
              overrideAccess: true,
            });
          }
          finalEligibleIds = [...eligibleIds, playerId];
        }

        const existing = await req.payload.find({
          collection: 'lineups',
          where: { fixture: { equals: fixtureId } },
          limit: 1,
          depth: 0,
          overrideAccess: true,
        });
        const lineup = existing.docs[0];
        const red = (lineup ? polyIds(lineup.redPlayers) : []).filter((id) => String(id) !== String(playerId));
        const green = (lineup ? polyIds(lineup.greenPlayers) : []).filter((id) => String(id) !== String(playerId));
        if (team === 'red') red.push(playerId);
        if (team === 'green') green.push(playerId);
        // Every id here comes from `eligiblePlayerIds`/the membership check
        // above — always a real group member — so 'users' is the right
        // kind for every write.
        const redPlayers = red.map((id) => polyRef('users', id));
        const greenPlayers = green.map((id) => polyRef('users', id));

        const saved = lineup
          ? await req.payload.update({
              collection: 'lineups',
              id: lineup.id,
              data: { redPlayers, greenPlayers },
              overrideAccess: true,
            })
          : await req.payload.create({
              collection: 'lineups',
              data: { fixture: fixtureId, redPlayers, greenPlayers },
              overrideAccess: true,
            });

        const savedRed = polyIds(saved.redPlayers);
        const savedGreen = polyIds(saved.greenPlayers);
        const strengthEnabled = Boolean(group?.features?.strength);
        const strengthMap = strengthEnabled ? await membershipStrengthByUser(req.payload, groupId, finalEligibleIds) : null;

        const result = await buildLineupSummaries(req.payload, groupId, fixtureId, finalEligibleIds, savedRed, savedGreen, strengthMap);

        return Response.json(result, { status: 200 });
      },
    },
    {
      // §5: server port of `autoTeams()` — sort by strength desc (falling
      // back to season-goals-only when `features.strength` is off, §3.8),
      // then snake-distribute 4-at-a-time into red/green. 403 when
      // `features.autoBalance` is off. Admin/organizer only (§3.4).
      path: '/:id/auto-balance',
      method: 'post',
      handler: async (req) => {
        if (!req.user) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const fixtureId = req.routeParams?.id;
        if (typeof fixtureId !== 'string' && typeof fixtureId !== 'number') {
          return Response.json({ error: 'Invalid fixture id' }, { status: 400 });
        }

        const fixture = await req.payload.findByID({
          collection: 'fixtures',
          id: fixtureId,
          depth: 1,
          overrideAccess: true,
        });
        if (!fixture) {
          return Response.json({ error: 'Not found' }, { status: 404 });
        }

        const group = typeof fixture.group === 'object' && fixture.group !== null ? fixture.group : null;
        const groupId = group ? group.id : fixture.group;

        const adminGroupIds = await membershipGroupIds(req, { roles: ['admin', 'organizer'] });
        if (!adminGroupIds.map(String).includes(String(groupId))) {
          return Response.json({ error: 'Forbidden' }, { status: 403 });
        }
        if (!group?.features?.autoBalance) {
          return Response.json({ error: 'Auto-balance is disabled for this group' }, { status: 403 });
        }

        const rsvpEnabled = Boolean(group?.features?.rsvp);
        const strengthEnabled = Boolean(group?.features?.strength);
        const seasonId = typeof fixture.season === 'object' && fixture.season !== null ? fixture.season.id : fixture.season;

        const eligibleIds = await eligiblePlayerIds(req.payload, groupId, fixtureId, rsvpEnabled);
        const [strengthMap, goalsMap] = await Promise.all([
          membershipStrengthByUser(req.payload, groupId, eligibleIds),
          seasonGoalsByUser(req.payload, seasonId, eligibleIds),
        ]);

        const sorted = [...eligibleIds].sort((a, b) => {
          const goalsDiff = (goalsMap.get(String(b)) ?? 0) - (goalsMap.get(String(a)) ?? 0);
          if (!strengthEnabled) return goalsDiff;
          const strengthDiff = (strengthMap.get(String(b)) ?? 3) - (strengthMap.get(String(a)) ?? 3);
          return strengthDiff !== 0 ? strengthDiff : goalsDiff;
        });

        const red: (string | number)[] = [];
        const green: (string | number)[] = [];
        sorted.forEach((id, i) => {
          (i % 4 === 0 || i % 4 === 3 ? red : green).push(id);
        });
        // Every id here comes from `eligiblePlayerIds` — always a real
        // group member — so 'users' is the right kind for every write.
        const redPlayers = red.map((id) => polyRef('users', id));
        const greenPlayers = green.map((id) => polyRef('users', id));

        const existing = await req.payload.find({
          collection: 'lineups',
          where: { fixture: { equals: fixtureId } },
          limit: 1,
          depth: 0,
          overrideAccess: true,
        });
        const lineup = existing.docs[0];
        if (lineup) {
          await req.payload.update({
            collection: 'lineups',
            id: lineup.id,
            data: { redPlayers, greenPlayers },
            overrideAccess: true,
          });
        } else {
          await req.payload.create({
            collection: 'lineups',
            data: { fixture: fixtureId, redPlayers, greenPlayers },
            overrideAccess: true,
          });
        }

        // `pool`/`notAttending` fall out of `buildLineupSummaries` on their
        // own (auto-balance splits every eligible id between red/green, so
        // pool naturally computes empty) — this used to hardcode
        // `pool: []` and never returned `notAttending` at all, which left
        // the app's cache missing that list after an auto-balance call.
        const strengthMapForSummary = strengthEnabled ? strengthMap : null;
        const result = await buildLineupSummaries(req.payload, groupId, fixtureId, eligibleIds, red, green, strengthMapForSummary);

        return Response.json(result, { status: 200 });
      },
    },
    {
      // §3.6: the recorded result for one fixture — Start's "last game"
      // card and to pre-fill Ergebnis erfassen when editing. Any group
      // member may read it. `mvp`/`goals[].player` are normalized back to
      // the plain (non-polymorphic) shape the app already expects —
      // `polyValue()` strips the `{relationTo,value}` wrapper Payload now
      // stores them in (§3.1, phase 6) since a *live* result only ever
      // references real `users` anyway (an imported one goes through the
      // generic `/api/players/:id/profile` path instead, not this
      // endpoint).
      path: '/:id/result',
      method: 'get',
      handler: async (req) => {
        if (!req.user) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const fixtureId = req.routeParams?.id;
        if (typeof fixtureId !== 'string' && typeof fixtureId !== 'number') {
          return Response.json({ error: 'Invalid fixture id' }, { status: 400 });
        }

        const fixture = await req.payload.findByID({ collection: 'fixtures', id: fixtureId, depth: 0, overrideAccess: true });
        if (!fixture) {
          return Response.json({ error: 'Not found' }, { status: 404 });
        }
        const groupId = typeof fixture.group === 'object' && fixture.group !== null ? fixture.group.id : fixture.group;

        const myGroupIds = await membershipGroupIds(req);
        if (!myGroupIds.map(String).includes(String(groupId))) {
          return Response.json({ error: 'Forbidden' }, { status: 403 });
        }

        const { docs } = await req.payload.find({
          collection: 'matchResults',
          where: { fixture: { equals: fixtureId } },
          limit: 1,
          depth: 1,
          overrideAccess: true,
        });
        const raw = docs[0];
        const result = raw
          ? {
              ...raw,
              mvp: polyValue(raw.mvp),
              goals: Array.isArray(raw.goals) ? raw.goals.map((g) => ({ ...g, player: polyValue(g.player) })) : raw.goals,
            }
          : null;

        return Response.json({ result }, { status: 200 });
      },
    },
    {
      // §3.2/§3.6: save (create or update) the result, flip the fixture to
      // "played", and recompute the affected players' season/career stats
      // caches from scratch (§3.2's recompute-not-increment design).
      // Admin/organizer only (§3.4).
      path: '/:id/result',
      method: 'post',
      handler: async (req) => {
        if (!req.user) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const fixtureId = req.routeParams?.id;
        if (typeof fixtureId !== 'string' && typeof fixtureId !== 'number') {
          return Response.json({ error: 'Invalid fixture id' }, { status: 400 });
        }

        let body: Record<string, unknown> = {};
        try {
          body = (await req.json?.()) ?? {};
        } catch {
          // handled by the validation below
        }
        const redScore = typeof body.redScore === 'number' ? body.redScore : undefined;
        const greenScore = typeof body.greenScore === 'number' ? body.greenScore : undefined;
        if (redScore === undefined || greenScore === undefined) {
          return Response.json({ error: 'redScore and greenScore are required' }, { status: 400 });
        }
        const redOwnGoals = typeof body.redOwnGoals === 'number' ? body.redOwnGoals : 0;
        const greenOwnGoals = typeof body.greenOwnGoals === 'number' ? body.greenOwnGoals : 0;
        const mvp = typeof body.mvp === 'string' || typeof body.mvp === 'number' ? body.mvp : undefined;
        const goals = Array.isArray(body.goals)
          ? body.goals
              .filter((g): g is Record<string, unknown> => typeof g === 'object' && g !== null)
              .map((g) => ({
                // Live result entry only ever references this fixture's own
                // lineup, which is always real `users` — see the note above.
                player: polyRef('users', g.player as string | number),
                team: g.team === 'red' || g.team === 'green' ? g.team : 'red',
                count: typeof g.count === 'number' ? g.count : 1,
              }))
          : [];

        const fixture = await req.payload.findByID({ collection: 'fixtures', id: fixtureId, depth: 1, overrideAccess: true });
        if (!fixture) {
          return Response.json({ error: 'Not found' }, { status: 404 });
        }

        const group = typeof fixture.group === 'object' && fixture.group !== null ? fixture.group : null;
        const groupId = group ? group.id : fixture.group;
        const seasonId = typeof fixture.season === 'object' && fixture.season !== null ? fixture.season.id : fixture.season;

        const adminGroupIds = await membershipGroupIds(req, { roles: ['admin', 'organizer'] });
        if (!adminGroupIds.map(String).includes(String(groupId))) {
          return Response.json({ error: 'Forbidden' }, { status: 403 });
        }

        const existing = await req.payload.find({
          collection: 'matchResults',
          where: { fixture: { equals: fixtureId } },
          limit: 1,
          overrideAccess: true,
        });

        const data = {
          fixture: fixtureId,
          redScore,
          greenScore,
          redOwnGoals,
          greenOwnGoals,
          mvp: mvp !== undefined ? polyRef('users', mvp) : undefined,
          goals,
          recordedBy: req.user.id,
          recordedAt: new Date().toISOString(),
        };

        const result = existing.docs[0]
          ? await req.payload.update({ collection: 'matchResults', id: existing.docs[0].id, data, overrideAccess: true })
          : await req.payload.create({ collection: 'matchResults', data, overrideAccess: true });

        if (fixture.status !== 'played') {
          await req.payload.update({ collection: 'fixtures', id: fixtureId, data: { status: 'played' }, overrideAccess: true });
        }

        const lineupResult = await req.payload.find({
          collection: 'lineups',
          where: { fixture: { equals: fixtureId } },
          limit: 1,
          depth: 0,
          overrideAccess: true,
        });
        const lineup = lineupResult.docs[0];
        const players = lineup ? [...polyRefs(lineup.redPlayers), ...polyRefs(lineup.greenPlayers)] : [];

        await recomputeStatsForPlayers(req.payload, { groupId, seasonId, players });

        return Response.json({ result }, { status: 200 });
      },
    },
  ],
  fields: [
    { name: 'group', type: 'relationship', relationTo: 'groups', required: true },
    { name: 'season', type: 'relationship', relationTo: 'seasons' },
    { name: 'date', type: 'date', required: true },
    { name: 'time', type: 'text', required: true, admin: { description: 'e.g. "20:00"' } },
    { name: 'hall', type: 'relationship', relationTo: 'halls' },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'upcoming',
      options: [
        { label: 'Bevorstehend', value: 'upcoming' },
        { label: 'Gespielt', value: 'played' },
      ],
    },
    {
      name: 'repeatGroupId',
      type: 'text',
      admin: { readOnly: true, description: 'Tags the 8 fixtures created by one "wöchentlich wiederholen" call.' },
    },
    { name: 'createdBy', type: 'relationship', relationTo: 'users', admin: { readOnly: true } },
  ],
};
