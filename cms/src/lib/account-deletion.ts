import type { Payload } from 'payload';

import { polyId, polyKind, polyRef } from './polymorphic';

/**
 * Self-service account deletion (Profil screen, "Konto löschen" — not in
 * the original plan). The tricky part isn't removing the `users` document
 * itself, it's everything that *references* it: `memberships` (join
 * table), and — via the polymorphic `[users, legacyPlayers]` relations
 * phase 6 introduced (`lib/polymorphic.ts`) — every `lineups`/
 * `matchResults`/`playerSeasonStats`/`playerCareerStats` row this person's
 * matches ever touched.
 *
 * Deleting those rows outright would corrupt every *other* member's stats
 * (a fixture's `redPlayers`/`goals[]` losing an entry changes who counts
 * as having played, and season/career totals would silently drop a
 * player's contribution from the group's history). This codebase already
 * has exactly the right shape for "a person who isn't a real account
 * anymore but still needs to exist in past results": `legacyPlayers`
 * (§3.7, phase 6). So per group the user belongs to, this creates one
 * fresh ghost profile and repoints every polymorphic reference at it —
 * the mirror image of `lib/claim.ts`'s `claimLegacyPlayer()` (legacy ->
 * real account), here going real account -> legacy. Simpler than that
 * function in one respect: the ghost profile is always brand new, so
 * there's never an existing-row merge to do (no `playerSeasonStats`/
 * `playerCareerStats` collision, unlike claiming into an account that may
 * already have its own rows) — every row is just re-pointed in place, and
 * the numbers in it don't change at all.
 *
 * `rsvps` rows (attendance answers) carry no historical/statistical
 * weight once the account is gone, so those are deleted outright rather
 * than reassigned — there's no "ghost RSVP" concept and nothing reads an
 * rsvp for a fixture except by asking "is this specific user in/out",
 * which no longer applies.
 *
 * If the account was the sole admin of a group, deleting it would leave
 * that group with no one able to manage it — so this promotes another
 * member (preferring an existing organizer) to admin first. A group where
 * this account was the *only* member is left as-is (no one to promote);
 * same "orphaned but harmless" category as the pre-existing "deleting a
 * group doesn't cascade-delete its memberships" gap noted elsewhere in
 * this codebase.
 *
 * Like `claimLegacyPlayer()`, "one transaction" means one call to this
 * function, not a shared database transaction — this codebase's Payload
 * local-API calls aren't wrapped in a mongoose session anywhere. Acceptable
 * for a rare, user-triggered action gated behind a password re-check.
 *
 * Does NOT delete the `users` document itself — the caller (`Users.ts`'s
 * `/delete-account` endpoint) does that once this returns, since that's
 * the one step that has to happen after everything referencing the user
 * has already been repointed/removed.
 *
 * Returns one `AdminTransfer` entry per group where this account was the
 * *sole* admin and someone else had to be promoted — so the caller (the
 * `/delete-account` endpoint, then the Profil screen) can tell the person
 * deleting their account exactly who now runs each group they organized,
 * rather than that happening invisibly. Empty when the account held no
 * group solely responsible for.
 */
export type AdminTransfer = { groupId: string | number; groupName: string; promotedUserName: string };

export async function deleteAccount(payload: Payload, userId: string | number): Promise<AdminTransfer[]> {
  const user = await payload.findByID({ collection: 'users', id: userId, depth: 0, overrideAccess: true });
  if (!user) return [];

  const transfers: AdminTransfer[] = [];

  const isThisUser = (v: unknown) => polyKind(v) === 'users' && String(polyId(v)) === String(userId);

  const { docs: memberships } = await payload.find({
    collection: 'memberships',
    where: { user: { equals: userId } },
    pagination: false,
    depth: 0,
    overrideAccess: true,
  });

  for (const membership of memberships) {
    const groupId = typeof membership.group === 'object' && membership.group !== null ? membership.group.id : membership.group;
    if (groupId == null) continue;

    // 1. A fresh ghost profile for this group — carries the name/position
    //    forward so past results/stats still show a recognizable name
    //    instead of turning into an anonymous blank.
    // eslint-disable-next-line no-await-in-loop -- bounded by how many groups one account can belong to; a rare, user-triggered action.
    const legacy = await payload.create({
      collection: 'legacyPlayers',
      data: {
        group: groupId,
        name: user.name,
        position: user.position,
        note: `Konto gelöscht am ${new Date().toISOString().slice(0, 10)}`,
      },
      overrideAccess: true,
    });
    const legacyRef = polyRef('legacyPlayers', legacy.id);

    // eslint-disable-next-line no-await-in-loop
    const { docs: fixtures } = await payload.find({
      collection: 'fixtures',
      where: { group: { equals: groupId } },
      pagination: false,
      depth: 0,
      overrideAccess: true,
    });
    const fixtureIds = fixtures.map((f) => f.id);

    if (fixtureIds.length > 0) {
      // 2. lineups.redPlayers / greenPlayers.
      // eslint-disable-next-line no-await-in-loop
      const { docs: lineups } = await payload.find({
        collection: 'lineups',
        where: { fixture: { in: fixtureIds } },
        pagination: false,
        depth: 0,
        overrideAccess: true,
      });
      for (const l of lineups) {
        const red = Array.isArray(l.redPlayers) ? l.redPlayers : [];
        const green = Array.isArray(l.greenPlayers) ? l.greenPlayers : [];
        const redHas = red.some(isThisUser);
        const greenHas = green.some(isThisUser);
        if (!redHas && !greenHas) continue;
        const data: Record<string, unknown> = {};
        if (redHas) data.redPlayers = red.map((p: unknown) => (isThisUser(p) ? legacyRef : p));
        if (greenHas) data.greenPlayers = green.map((p: unknown) => (isThisUser(p) ? legacyRef : p));
        // eslint-disable-next-line no-await-in-loop
        await payload.update({ collection: 'lineups', id: l.id, data, overrideAccess: true });
      }

      // 3. matchResults.mvp / goals[].player.
      // eslint-disable-next-line no-await-in-loop
      const { docs: results } = await payload.find({
        collection: 'matchResults',
        where: { fixture: { in: fixtureIds } },
        pagination: false,
        depth: 0,
        overrideAccess: true,
      });
      for (const r of results) {
        const data: Record<string, unknown> = {};
        let changed = false;
        if (isThisUser(r.mvp)) {
          data.mvp = legacyRef;
          changed = true;
        }
        if (Array.isArray(r.goals) && (r.goals as Array<Record<string, unknown>>).some((g) => isThisUser(g.player))) {
          data.goals = (r.goals as Array<Record<string, unknown>>).map((g) => (isThisUser(g.player) ? { ...g, player: legacyRef } : g));
          changed = true;
        }
        if (changed) {
          // eslint-disable-next-line no-await-in-loop
          await payload.update({ collection: 'matchResults', id: r.id, data, overrideAccess: true });
        }
      }

      // 4. rsvps carry no historical weight — just remove this user's answers.
      // eslint-disable-next-line no-await-in-loop
      await payload.delete({
        collection: 'rsvps',
        where: { fixture: { in: fixtureIds }, user: { equals: userId } },
        overrideAccess: true,
      });
    }

    // 5. playerSeasonStats.player — scoped to this group's own seasons
    //    (the polymorphic `player` field can't safely be queried with a
    //    plain `where`, same limitation `stats.ts`/`claim.ts` document —
    //    fetch this group's season rows and filter in memory instead).
    // eslint-disable-next-line no-await-in-loop
    const { docs: seasons } = await payload.find({
      collection: 'seasons',
      where: { group: { equals: groupId } },
      pagination: false,
      depth: 0,
      overrideAccess: true,
    });
    for (const season of seasons) {
      // eslint-disable-next-line no-await-in-loop
      const { docs: seasonRows } = await payload.find({
        collection: 'playerSeasonStats',
        where: { season: { equals: season.id } },
        pagination: false,
        depth: 0,
        overrideAccess: true,
      });
      for (const row of seasonRows) {
        if (!isThisUser(row.player)) continue;
        // eslint-disable-next-line no-await-in-loop
        await payload.update({ collection: 'playerSeasonStats', id: row.id, data: { player: legacyRef }, overrideAccess: true });
      }
    }

    // 6. playerCareerStats.player — one row per (player, group); always a
    //    plain re-point, never a merge, since `legacy` is brand new.
    // eslint-disable-next-line no-await-in-loop
    const { docs: careerRows } = await payload.find({
      collection: 'playerCareerStats',
      where: { group: { equals: groupId } },
      pagination: false,
      depth: 0,
      overrideAccess: true,
    });
    for (const row of careerRows) {
      if (!isThisUser(row.player)) continue;
      // eslint-disable-next-line no-await-in-loop
      await payload.update({ collection: 'playerCareerStats', id: row.id, data: { player: legacyRef }, overrideAccess: true });
    }

    // 7. Don't leave the group without anyone able to manage it. Only
    //    matters if this account was an admin — a departing organizer/
    //    player never held that responsibility to begin with. Promotion
    //    order is deterministic (earliest-joined organizer, else
    //    earliest-joined member) rather than whatever order the database
    //    happens to return — this decides who ends up running someone
    //    else's group, so it shouldn't be arbitrary.
    if (membership.role === 'admin') {
      // eslint-disable-next-line no-await-in-loop
      const { docs: otherMemberships } = await payload.find({
        collection: 'memberships',
        where: { group: { equals: groupId }, id: { not_equals: membership.id } },
        sort: 'joinedAt',
        pagination: false,
        depth: 0,
        overrideAccess: true,
      });
      const stillHasAdmin = otherMemberships.some((m) => m.role === 'admin');
      if (!stillHasAdmin) {
        const promotee = otherMemberships.find((m) => m.role === 'organizer') ?? otherMemberships[0];
        if (promotee) {
          // eslint-disable-next-line no-await-in-loop
          await payload.update({ collection: 'memberships', id: promotee.id, data: { role: 'admin' }, overrideAccess: true });
          // eslint-disable-next-line no-await-in-loop
          const promotedUser = await payload.findByID({
            collection: 'users',
            id: typeof promotee.user === 'object' && promotee.user !== null ? promotee.user.id : promotee.user,
            depth: 0,
            overrideAccess: true,
          });
          const group = await payload.findByID({ collection: 'groups', id: groupId, depth: 0, overrideAccess: true });
          transfers.push({
            groupId,
            groupName: (group?.name as string | undefined) ?? '?',
            promotedUserName: (promotedUser?.name as string | undefined) ?? '?',
          });
        }
      }
    }

    // 8. Finally drop this account's own membership row for the group.
    // eslint-disable-next-line no-await-in-loop
    await payload.delete({ collection: 'memberships', id: membership.id, overrideAccess: true });
  }

  return transfers;
}
