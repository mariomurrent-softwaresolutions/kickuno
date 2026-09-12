import type { Payload } from 'payload';

import { polyId, polyKind, polyRef, type PolyKind } from './polymorphic';
import { recomputeStatsForPlayers } from './stats';

/**
 * Reassigns every polymorphic reference to a `legacyPlayers` "ghost"
 * profile onto a real `users` account — implementation-plan.md §3.7: "if
 * someone from legacyPlayers rejoins and creates a real account...
 * reassigns every polymorphic reference (`matchResults.goals[].player`,
 * `matchResults.mvp`, `lineups.redPlayers/greenPlayers`,
 * `playerSeasonStats.player`, `playerCareerStats.player`) from the
 * `legacyPlayers` id to the `users` id in one transaction, sets
 * `legacyPlayers.claimedBy`, and folds any `baseline*` numbers into that
 * player's `playerCareerStats` row."
 *
 * "One transaction" here means one call to this function, not a shared
 * database transaction — this codebase's Payload local-API calls aren't
 * wrapped in a mongoose session anywhere (see `stats.ts`'s similar note);
 * acceptable for a rare, admin-triggered action like this one.
 *
 * Reassigning can create a same-key collision: the claiming user may
 * already have their own `playerSeasonStats`/`playerCareerStats` rows (they
 * were already a member before claiming, just under their own account from
 * whenever they rejoined). `playerSeasonStats`'s numbers are pure
 * match-derived, so it's safe to just delete the legacy row where the user
 * already has one for that season and let the recompute at the end rebuild
 * it correctly. `playerCareerStats` additionally carries `baseline*` (never
 * touched by recompute) — that has to be summed into the surviving row
 * before the legacy one is dropped, or the imported lump-sum baseline is
 * lost for good.
 */
export async function claimLegacyPlayer(
  payload: Payload,
  opts: { legacyId: string | number; groupId: string | number; userId: string | number },
): Promise<void> {
  const { legacyId, groupId, userId } = opts;
  const isThisLegacy = (v: unknown) => polyKind(v) === 'legacyPlayers' && String(polyId(v)) === String(legacyId);

  // 1. matchResults.mvp / goals[].player.
  const { docs: results } = await payload.find({ collection: 'matchResults', pagination: false, depth: 0, overrideAccess: true });
  for (const r of results) {
    const data: Record<string, unknown> = {};
    let changed = false;
    if (isThisLegacy(r.mvp)) {
      data.mvp = polyRef('users', userId);
      changed = true;
    }
    if (Array.isArray(r.goals) && (r.goals as Array<Record<string, unknown>>).some((g) => isThisLegacy(g.player))) {
      data.goals = (r.goals as Array<Record<string, unknown>>).map((g) => (isThisLegacy(g.player) ? { ...g, player: polyRef('users', userId) } : g));
      changed = true;
    }
    if (changed) {
      // eslint-disable-next-line no-await-in-loop -- bounded by one group's match history; a rare, admin-triggered action.
      await payload.update({ collection: 'matchResults', id: r.id, data, overrideAccess: true });
    }
  }

  // 2. lineups.redPlayers / greenPlayers.
  const { docs: lineups } = await payload.find({ collection: 'lineups', pagination: false, depth: 0, overrideAccess: true });
  for (const l of lineups) {
    const red = Array.isArray(l.redPlayers) ? l.redPlayers : [];
    const green = Array.isArray(l.greenPlayers) ? l.greenPlayers : [];
    const redHas = red.some(isThisLegacy);
    const greenHas = green.some(isThisLegacy);
    if (!redHas && !greenHas) continue;
    const data: Record<string, unknown> = {};
    if (redHas) data.redPlayers = red.map((p: unknown) => (isThisLegacy(p) ? polyRef('users', userId) : p));
    if (greenHas) data.greenPlayers = green.map((p: unknown) => (isThisLegacy(p) ? polyRef('users', userId) : p));
    // eslint-disable-next-line no-await-in-loop
    await payload.update({ collection: 'lineups', id: l.id, data, overrideAccess: true });
  }

  // 3. playerSeasonStats — drop the legacy row where the user already has
  //    one for that season, else reassign it in place (so the recompute
  //    below updates the same row instead of creating a duplicate).
  const { docs: seasonRows } = await payload.find({ collection: 'playerSeasonStats', pagination: false, depth: 0, overrideAccess: true });
  const seasonIdOf = (row: (typeof seasonRows)[number]) =>
    (typeof row.season === 'object' && row.season !== null ? (row.season as { id: unknown }).id : row.season) as string | number;
  const userSeasonKeys = new Set(
    seasonRows
      .filter((row) => polyKind(row.player) === 'users' && String(polyId(row.player)) === String(userId))
      .map((row) => String(seasonIdOf(row))),
  );
  const touchedSeasonIds = new Set<string | number>();
  for (const row of seasonRows) {
    if (!isThisLegacy(row.player)) continue;
    const seasonId = seasonIdOf(row);
    touchedSeasonIds.add(seasonId);
    if (userSeasonKeys.has(String(seasonId))) {
      // eslint-disable-next-line no-await-in-loop
      await payload.delete({ collection: 'playerSeasonStats', id: row.id, overrideAccess: true });
    } else {
      // eslint-disable-next-line no-await-in-loop
      await payload.update({ collection: 'playerSeasonStats', id: row.id, data: { player: polyRef('users', userId) }, overrideAccess: true });
    }
  }

  // 4. playerCareerStats — one row per (player, group); sum baseline* into
  //    the surviving row before dropping the legacy one.
  const { docs: careerRows } = await payload.find({
    collection: 'playerCareerStats',
    where: { group: { equals: groupId } },
    pagination: false,
    depth: 0,
    overrideAccess: true,
  });
  const legacyCareer = careerRows.find((row) => isThisLegacy(row.player));
  const userCareer = careerRows.find((row) => polyKind(row.player) === 'users' && String(polyId(row.player)) === String(userId));
  if (legacyCareer && userCareer) {
    const sum = (a: unknown, b: unknown) => (typeof a === 'number' ? a : 0) + (typeof b === 'number' ? b : 0);
    await payload.update({
      collection: 'playerCareerStats',
      id: userCareer.id,
      data: {
        baselinePlayed: sum(userCareer.baselinePlayed, legacyCareer.baselinePlayed),
        baselineWins: sum(userCareer.baselineWins, legacyCareer.baselineWins),
        baselineDraws: sum(userCareer.baselineDraws, legacyCareer.baselineDraws),
        baselineLosses: sum(userCareer.baselineLosses, legacyCareer.baselineLosses),
        baselineGoals: sum(userCareer.baselineGoals, legacyCareer.baselineGoals),
        baselineOwnGoals: sum(userCareer.baselineOwnGoals, legacyCareer.baselineOwnGoals),
        baselineMvps: sum(userCareer.baselineMvps, legacyCareer.baselineMvps),
        baselineGoalDiff: sum(userCareer.baselineGoalDiff, legacyCareer.baselineGoalDiff),
      },
      overrideAccess: true,
    });
    await payload.delete({ collection: 'playerCareerStats', id: legacyCareer.id, overrideAccess: true });
  } else if (legacyCareer) {
    await payload.update({ collection: 'playerCareerStats', id: legacyCareer.id, data: { player: polyRef('users', userId) }, overrideAccess: true });
  }

  // 5. Mark the ghost profile claimed — kept for audit, never deleted.
  await payload.update({ collection: 'legacyPlayers', id: legacyId, data: { claimedBy: userId }, overrideAccess: true });

  // 6. Recompute the claiming user's stats: once per season touched above
  //    (rebuilds that season's row from the now-reassigned matches), plus
  //    career (every call recomputes career regardless of `seasonId`).
  const players = [{ id: userId, kind: 'users' as PolyKind }];
  if (touchedSeasonIds.size > 0) {
    for (const seasonId of touchedSeasonIds) {
      // eslint-disable-next-line no-await-in-loop -- small, bounded set of seasons.
      await recomputeStatsForPlayers(payload, { groupId, seasonId, players });
    }
  } else {
    await recomputeStatsForPlayers(payload, { groupId, players });
  }
}
