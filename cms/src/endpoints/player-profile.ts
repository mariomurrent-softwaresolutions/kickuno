import type { Endpoint } from 'payload';

import { membershipGroupIds } from '../access/helpers';
import { getActiveSeason } from '../lib/season';
import { computeGroupPlayerStats, last5Form } from '../lib/stats-query';
import type { PolyKind } from '../lib/polymorphic';

function isPolyKind(value: unknown): value is PolyKind {
  return value === 'users' || value === 'legacyPlayers';
}

/**
 * Root-level (not collection-scoped) endpoint — `GET
 * /api/players/:id/profile?group=&kind=users|legacyPlayers`. Replaces the
 * phase-5 `Users.ts` `/:id/profile` endpoint: the Spielerprofil screen now
 * has to show *either* a real member or a `legacyPlayers` "ghost" profile
 * (§3.7, phase 6 — "Spielerprofil incl. legacyPlayers read-only profiles"
 * per the roadmap's own phase-5 entry), and a profile spanning two
 * collections doesn't belong on either one specifically. `kind` defaults
 * to `users` so the Profil tab's existing "Mein Spielerprofil" link (which
 * predates `kind` and never sends it) keeps working unchanged.
 */
export const playerProfileEndpoint: Endpoint = {
  path: '/players/:id/profile',
  method: 'get',
  handler: async (req) => {
    if (!req.user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const playerId = req.routeParams?.id;
    if (typeof playerId !== 'string' && typeof playerId !== 'number') {
      return Response.json({ error: 'Invalid player id' }, { status: 400 });
    }

    const groupId = req.query?.group;
    if (typeof groupId !== 'string' && typeof groupId !== 'number') {
      return Response.json({ error: 'Missing group' }, { status: 400 });
    }

    const kindParam = req.query?.kind;
    const kind: PolyKind = isPolyKind(kindParam) ? kindParam : 'users';

    const myGroupIds = await membershipGroupIds(req);
    if (!myGroupIds.map(String).includes(String(groupId))) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    let name: string;
    let initials: string | undefined;
    let position: string | undefined;
    let memberSinceYear: number | undefined;
    let strength: number | undefined;
    let role: 'admin' | 'organizer' | 'player' | undefined;
    let note: string | undefined;
    let claimed: boolean | undefined;

    if (kind === 'users') {
      const membershipResult = await req.payload.find({
        collection: 'memberships',
        where: { user: { equals: playerId }, group: { equals: groupId } },
        limit: 1,
        depth: 1,
        overrideAccess: true,
      });
      const membership = membershipResult.docs[0];
      const user = membership && typeof membership.user === 'object' && membership.user !== null ? membership.user : null;
      if (!membership || !user) {
        return Response.json({ error: 'Not found' }, { status: 404 });
      }
      name = user.name;
      initials = user.initials ?? undefined;
      position = user.position ?? undefined;
      memberSinceYear = user.memberSince ? new Date(user.memberSince as string).getUTCFullYear() : undefined;
      strength = membership.strength ?? undefined;
      role = membership.role;
    } else {
      const legacy = await req.payload.findByID({
        collection: 'legacyPlayers',
        id: playerId,
        depth: 0,
        overrideAccess: true,
      });
      const legacyGroupId = legacy && typeof legacy.group === 'object' && legacy.group !== null ? legacy.group.id : legacy?.group;
      if (!legacy || String(legacyGroupId) !== String(groupId)) {
        return Response.json({ error: 'Not found' }, { status: 404 });
      }
      name = legacy.name;
      initials = legacy.initials ?? undefined;
      position = legacy.position ?? undefined;
      note = legacy.note ?? undefined;
      claimed = Boolean(legacy.claimedBy);
    }

    // `season=<id>` (optional) lets the app view any of the group's
    // seasons, not just whichever is active — same "statistics for each
    // season" support the Statistik screen's season picker already has
    // (feature-plan-stats-enhancements.md context). Falls back to
    // `getActiveSeason` (read-only, never `getOrCreateCurrentSeason` — see
    // the note below) when no explicit `season` param is given, so every
    // existing call site (Spielerprofil before this) keeps working
    // unchanged.
    const seasonParam = req.query?.season;
    let season: { id: string | number } | null = null;
    if (typeof seasonParam === 'string' || typeof seasonParam === 'number') {
      const requested = await req.payload.findByID({
        collection: 'seasons',
        id: seasonParam,
        depth: 0,
        overrideAccess: true,
      });
      const requestedGroupId = requested && typeof requested.group === 'object' && requested.group !== null ? requested.group.id : requested?.group;
      if (!requested || String(requestedGroupId) !== String(groupId)) {
        return Response.json({ error: 'Season not found' }, { status: 404 });
      }
      season = requested;
    } else {
      // Deliberately `getActiveSeason` (read-only), never
      // `getOrCreateCurrentSeason` — viewing a Spielerprofil is a plain
      // read, and letting it spawn a season as a side effect was the same
      // bug class already fixed in `strength.ts` and `stats.ts` (see
      // getting-started.md). When a group genuinely has no active season
      // yet, this just reports zeroed-out season stats (same as any
      // brand-new player would show) instead of creating one.
      season = await getActiveSeason(req.payload, groupId);
    }

    const [seasonRows, allTimeRows] = await Promise.all([
      season ? computeGroupPlayerStats(req.payload, groupId, season.id) : Promise.resolve([]),
      computeGroupPlayerStats(req.payload, groupId),
    ]);
    const seasonRow = seasonRows.find((r) => r.playerId === String(playerId) && r.playerKind === kind);
    const allTimeRow = allTimeRows.find((r) => r.playerId === String(playerId) && r.playerKind === kind);

    const seasonDoc = season
      ? await req.payload.findByID({
          collection: 'seasons',
          id: season.id,
          depth: 0,
          overrideAccess: true,
        })
      : null;

    const quote = (played: number, wins: number) => Math.round((wins / Math.max(1, played)) * 100);

    return Response.json(
      {
        player: {
          id: String(playerId),
          kind,
          name,
          initials,
          position,
          memberSinceYear,
          strength,
          role,
          note,
          claimed,
        },
        // §6: rolling form indicator — based on the player's most recent
        // matches overall, not reset at the season boundary (so it stays
        // meaningful right after a new season starts).
        form: allTimeRow ? last5Form(allTimeRow.matches) : [],
        season: {
          id: seasonDoc ? String(seasonDoc.id) : undefined,
          label: seasonDoc?.label ?? '',
          played: seasonRow?.played ?? 0,
          wins: seasonRow?.wins ?? 0,
          draws: seasonRow?.draws ?? 0,
          losses: seasonRow?.losses ?? 0,
          goals: seasonRow?.goals ?? 0,
          goalDiff: seasonRow?.goalDiff ?? 0,
          mvps: seasonRow?.mvps ?? 0,
          quote: quote(seasonRow?.played ?? 0, seasonRow?.wins ?? 0),
        },
        allTime: {
          played: allTimeRow?.played ?? 0,
          wins: allTimeRow?.wins ?? 0,
          goals: allTimeRow?.goals ?? 0,
          quote: quote(allTimeRow?.played ?? 0, allTimeRow?.wins ?? 0),
          mvps: allTimeRow?.mvps ?? 0,
          ownGoals: allTimeRow?.ownGoals ?? 0,
        },
      },
      { status: 200 },
    );
  },
};
