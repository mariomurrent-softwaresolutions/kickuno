import type { Payload } from 'payload';

import { polyId, polyKind, polyRefs } from '../lib/polymorphic';
import { recomputeStatsForPlayers } from '../lib/stats';
import type { ChangeLog } from './types';

/**
 * Undoes exactly one import batch — implementation-plan.md §3.7: "a bad
 * import can be identified and reverted (delete everything sharing that
 * `importBatch` id) without touching anything recorded live." Dispatches on
 * `importBatches.changeLog` (written by whichever `run*Import` produced the
 * batch — see `types.ts`), so each import kind undoes only what it actually
 * did:
 *
 * - `fixtures`: deletes the created `matchResults`/`lineups`/`fixtures` rows,
 *   then recomputes stats for every affected player (so their season/career
 *   caches reflect the removal), then deletes any hall/season/legacyPlayers
 *   rows this batch *created* — but only if nothing else in the database
 *   still references them (a later import or live use may have started
 *   using a hall/season/ghost-player this batch happened to create first).
 * - `career-baseline`: restores each touched `playerCareerStats` row's
 *   `baseline*` fields to their pre-import values (0 for a row this batch
 *   created outright — never deletes the row itself, since real match
 *   stats may have accumulated on it since the import ran), restores any
 *   `users.memberSince` this batch overwrote, and removes any legacy
 *   players it created (same unreferenced-elsewhere check as above).
 * - `legacy-players`: removes created `legacyPlayers` rows (same check) and
 *   reverts `position`/`note` on rows it only filled in.
 *
 * Refuses to run on a batch that isn't `status: committed` (nothing to undo
 * for a draft/already-rolled-back one).
 */
export async function rollbackImportBatch(payload: Payload, importBatchId: string | number): Promise<{ note: string[] }> {
  const batch = await payload.findByID({ collection: 'importBatches', id: importBatchId, depth: 0, overrideAccess: true });
  if (!batch) throw new Error(`Import-Batch ${importBatchId} nicht gefunden.`);
  if (batch.status !== 'committed') {
    throw new Error(`Import-Batch ${importBatchId} hat Status "${batch.status}" — nur "committed" kann zurückgerollt werden.`);
  }
  const changeLog = batch.changeLog as ChangeLog | undefined;
  if (!changeLog) throw new Error(`Import-Batch ${importBatchId} hat keinen changeLog — kann nicht automatisch zurückgerollt werden.`);

  const notes: string[] = [];

  if (changeLog.kind === 'fixtures') {
    for (const id of changeLog.createdMatchResultIds) {
      await payload.delete({ collection: 'matchResults', id, overrideAccess: true });
    }
    for (const id of changeLog.createdLineupIds) {
      await payload.delete({ collection: 'lineups', id, overrideAccess: true });
    }
    for (const id of changeLog.createdFixtureIds) {
      await payload.delete({ collection: 'fixtures', id, overrideAccess: true });
    }
    notes.push(`${changeLog.createdFixtureIds.length} Termin(e) inkl. Aufstellung/Ergebnis gelöscht.`);

    if (changeLog.affectedPlayers.length > 0) {
      if (changeLog.affectedSeasonIds.length > 0) {
        for (const seasonId of changeLog.affectedSeasonIds) {
          // eslint-disable-next-line no-await-in-loop -- small, bounded set of seasons touched by one import run.
          await recomputeStatsForPlayers(payload, { groupId: batch.group, seasonId, players: changeLog.affectedPlayers });
        }
      } else {
        await recomputeStatsForPlayers(payload, { groupId: batch.group, players: changeLog.affectedPlayers });
      }
      notes.push(`Statistiken für ${changeLog.affectedPlayers.length} Spieler neu berechnet.`);
    }

    const { halls, seasons } = await referencedHallAndSeasonIds(payload);
    for (const id of changeLog.createdHallIds) {
      if (!halls.has(String(id))) {
        await payload.delete({ collection: 'halls', id, overrideAccess: true });
      } else {
        notes.push(`Halle ${id} wird noch verwendet — nicht gelöscht.`);
      }
    }
    for (const id of changeLog.createdSeasonIds) {
      if (!seasons.has(String(id))) {
        await payload.delete({ collection: 'seasons', id, overrideAccess: true });
      } else {
        notes.push(`Saison ${id} wird noch verwendet — nicht gelöscht.`);
      }
    }

    await deleteUnreferencedLegacyPlayers(payload, changeLog.createdLegacyPlayerIds, notes);
  } else if (changeLog.kind === 'career-baseline') {
    for (const update of changeLog.playerUpdates) {
      const restore = update.priorBaseline ?? {
        baselinePlayed: 0,
        baselineWins: 0,
        baselineDraws: 0,
        baselineLosses: 0,
        baselineGoals: 0,
        baselineOwnGoals: 0,
        baselineMvps: 0,
        baselineGoalDiff: 0,
      };
      await payload.update({ collection: 'playerCareerStats', id: update.careerStatsId, data: restore, overrideAccess: true });
    }
    notes.push(`${changeLog.playerUpdates.length} playerCareerStats-Baseline-Wert(e) zurückgesetzt.`);

    for (const update of changeLog.memberSinceUpdates) {
      await payload.update({
        collection: 'users',
        id: update.userId,
        data: { memberSince: update.priorMemberSince },
        overrideAccess: true,
      });
    }
    if (changeLog.memberSinceUpdates.length > 0) {
      notes.push(`${changeLog.memberSinceUpdates.length} memberSince-Wert(e) wiederhergestellt.`);
    }

    const createdLegacyIds = changeLog.playerUpdates.map((u) => u.createdLegacyPlayerId).filter((id): id is string | number => id !== undefined);
    await deleteUnreferencedLegacyPlayers(payload, createdLegacyIds, notes);
  } else if (changeLog.kind === 'legacy-players') {
    for (const update of changeLog.updatedLegacyPlayers) {
      await payload.update({
        collection: 'legacyPlayers',
        id: update.id,
        data: { position: update.priorPosition, note: update.priorNote },
        overrideAccess: true,
      });
    }
    if (changeLog.updatedLegacyPlayers.length > 0) {
      notes.push(`${changeLog.updatedLegacyPlayers.length} Ehemalige-Spieler-Feld(er) zurückgesetzt.`);
    }
    await deleteUnreferencedLegacyPlayers(payload, changeLog.createdLegacyPlayerIds, notes);
  }

  await payload.update({ collection: 'importBatches', id: importBatchId, data: { status: 'rolled-back' }, overrideAccess: true });
  return { note: notes };
}

/** Every `legacyPlayers` id currently referenced by any lineup or matchResult, across the whole database (checked once per rollback call, not per candidate id). */
async function referencedLegacyPlayerKeys(payload: Payload): Promise<Set<string>> {
  const [{ docs: lineups }, { docs: results }] = await Promise.all([
    payload.find({ collection: 'lineups', pagination: false, depth: 0, overrideAccess: true }),
    payload.find({ collection: 'matchResults', pagination: false, depth: 0, overrideAccess: true }),
  ]);
  const keys = new Set<string>();
  for (const l of lineups) {
    for (const ref of [...polyRefs(l.redPlayers), ...polyRefs(l.greenPlayers)]) {
      if (ref.kind === 'legacyPlayers') keys.add(String(ref.id));
    }
  }
  for (const r of results) {
    const mvpId = polyId(r.mvp);
    const mvpKind = polyKind(r.mvp);
    if (mvpKind === 'legacyPlayers' && mvpId !== undefined) keys.add(String(mvpId));
    if (Array.isArray(r.goals)) {
      for (const g of r.goals as Array<Record<string, unknown>>) {
        const pid = polyId(g.player);
        const pkind = polyKind(g.player);
        if (pkind === 'legacyPlayers' && pid !== undefined) keys.add(String(pid));
      }
    }
  }
  return keys;
}

async function referencedHallAndSeasonIds(payload: Payload): Promise<{ halls: Set<string>; seasons: Set<string> }> {
  const { docs } = await payload.find({ collection: 'fixtures', pagination: false, depth: 0, overrideAccess: true });
  const halls = new Set<string>();
  const seasons = new Set<string>();
  for (const f of docs) {
    const hallId = typeof f.hall === 'object' && f.hall !== null ? (f.hall as { id: unknown }).id : f.hall;
    if (hallId !== undefined && hallId !== null) halls.add(String(hallId));
    const seasonId = typeof f.season === 'object' && f.season !== null ? (f.season as { id: unknown }).id : f.season;
    if (seasonId !== undefined && seasonId !== null) seasons.add(String(seasonId));
  }
  return { halls, seasons };
}

async function deleteUnreferencedLegacyPlayers(payload: Payload, ids: (string | number)[], notes: string[]) {
  if (ids.length === 0) return;
  const referenced = await referencedLegacyPlayerKeys(payload);
  for (const id of ids) {
    if (referenced.has(String(id))) {
      notes.push(`Ehemalige(r) Spieler(in) ${id} wird noch referenziert — nicht gelöscht.`);
      continue;
    }
    // A now-orphaned legacy player may still have zeroed playerSeasonStats/
    // playerCareerStats rows left from the recompute that just ran (fixtures
    // kind) — clean those up too so no dangling reference remains.
    const [{ docs: seasonRows }, { docs: careerRows }] = await Promise.all([
      payload.find({ collection: 'playerSeasonStats', pagination: false, depth: 0, overrideAccess: true }),
      payload.find({ collection: 'playerCareerStats', pagination: false, depth: 0, overrideAccess: true }),
    ]);
    for (const row of seasonRows) {
      if (polyKind(row.player) === 'legacyPlayers' && String(polyId(row.player)) === String(id)) {
        // eslint-disable-next-line no-await-in-loop -- bounded by one group's roster size.
        await payload.delete({ collection: 'playerSeasonStats', id: row.id, overrideAccess: true });
      }
    }
    for (const row of careerRows) {
      if (polyKind(row.player) === 'legacyPlayers' && String(polyId(row.player)) === String(id)) {
        // eslint-disable-next-line no-await-in-loop
        await payload.delete({ collection: 'playerCareerStats', id: row.id, overrideAccess: true });
      }
    }
    await payload.delete({ collection: 'legacyPlayers', id, overrideAccess: true });
  }
}
