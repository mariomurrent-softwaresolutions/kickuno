import type { Payload } from 'payload';

import { polyRef } from '../lib/polymorphic';
import { recomputeStatsForPlayers } from '../lib/stats';
import { parseCsv, parseDateCell, parseGoalList } from './csv';
import { buildPlayerIndex, findOrCreateHall, findOrCreateSeason, type PlayerAliasMap, type ResolvedPlayer } from './resolve';
import type { CommitResult, FixturesChangeLog, ImportIssue, ImportPreview, PlayerRef } from './types';

/**
 * Path A of implementation-plan.md §3.7 — `fixtures.csv`: match-by-match
 * history. Columns: `date, time, hall, season, redScore, greenScore,
 * redOwnGoals, greenOwnGoals, mvp, redGoals, greenGoals` (`redGoals`/
 * `greenGoals` are `Name:count;Name:count`). Each valid row becomes one
 * `fixtures` (`status: played`) + `lineups` + `matchResults` row, flowing
 * through the exact same shape `matchResults.afterChange` would produce for
 * a live result — season stats, career stats, streaks and podiums all just
 * work for imported nights too, with zero special-case logic downstream.
 *
 * **Known, deliberate gap** (inherited from the CSV spec itself, not a bug):
 * there's no full-roster column, only scorers and an MVP. So a match's
 * `lineups` row can only ever include players who scored — an imported
 * night's non-scoring participants simply aren't linked to it, undercounting
 * their `played`/`wins`/`losses`/`goalDiff` for that game. Worse, if the MVP
 * *isn't* one of the scorers, there is no column saying which side they were
 * on — putting them on a guessed side would silently corrupt win/loss/
 * goalDiff for that match, which is worse than the gap it "fixes", so this
 * importer leaves a non-scoring MVP off both lineups (their `matchResults.mvp`
 * reference is still recorded — the fact isn't lost — just not reflected in
 * their aggregated stats for that night). Revisit only if the CSV template
 * grows a roster/side column.
 */

type ParsedFixtureRow = {
  rowNum: number;
  dateIso: string;
  time: string;
  hallName: string;
  seasonLabel: string;
  redScore: number;
  greenScore: number;
  redOwnGoals: number;
  greenOwnGoals: number;
  mvpName?: string;
  redGoals: { name: string; count: number }[];
  greenGoals: { name: string; count: number }[];
};

function toNumberOr(raw: string | undefined, fallback: number): number | undefined {
  const trimmed = (raw ?? '').trim();
  if (trimmed === '') return fallback;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : undefined;
}

function parseRows(csvText: string, issues: ImportIssue[]): ParsedFixtureRow[] {
  const raw = parseCsv(csvText);
  const rows: ParsedFixtureRow[] = [];

  raw.forEach((r, i) => {
    const rowNum = i + 1;
    const dateIso = parseDateCell(r.date ?? '');
    if (!dateIso) {
      issues.push({ row: rowNum, message: `Ungültiges Datum: "${r.date ?? ''}" (erwartet YYYY-MM-DD oder DD.MM.YYYY)`, blocking: true });
      return;
    }
    if (!r.hall?.trim()) {
      issues.push({ row: rowNum, message: 'Halle fehlt', blocking: true });
      return;
    }
    if (!r.season?.trim()) {
      issues.push({ row: rowNum, message: 'Saison fehlt', blocking: true });
      return;
    }
    const redScore = toNumberOr(r.redScore, NaN);
    const greenScore = toNumberOr(r.greenScore, NaN);
    if (redScore === undefined || Number.isNaN(redScore) || greenScore === undefined || Number.isNaN(greenScore)) {
      issues.push({ row: rowNum, message: 'redScore/greenScore fehlt oder ungültig', blocking: true });
      return;
    }
    const redOwnGoals = toNumberOr(r.redOwnGoals, 0) ?? 0;
    const greenOwnGoals = toNumberOr(r.greenOwnGoals, 0) ?? 0;

    rows.push({
      rowNum,
      dateIso,
      time: r.time?.trim() || '20:00',
      hallName: r.hall.trim(),
      seasonLabel: r.season.trim(),
      redScore,
      greenScore,
      redOwnGoals,
      greenOwnGoals,
      mvpName: r.mvp?.trim() || undefined,
      redGoals: parseGoalList(r.redGoals ?? ''),
      greenGoals: parseGoalList(r.greenGoals ?? ''),
    });
  });

  return rows;
}

function refKey(ref: PlayerRef): string {
  return `${ref.kind}:${ref.id}`;
}

export async function runFixturesImport(
  payload: Payload,
  opts: {
    groupId: string | number;
    fileName: string;
    csvText: string;
    aliases?: PlayerAliasMap;
    dryRun: boolean;
    forceDuplicates?: boolean;
    uploadedBy?: string | number;
  },
): Promise<{ preview: ImportPreview; commit?: CommitResult }> {
  const issues: ImportIssue[] = [];
  const rows = parseRows(opts.csvText, issues);
  const index = await buildPlayerIndex(payload, opts.groupId, opts.aliases ?? {});

  const allNames = new Set<string>();
  for (const row of rows) {
    if (row.mvpName) allNames.add(row.mvpName);
    for (const g of row.redGoals) allNames.add(g.name);
    for (const g of row.greenGoals) allNames.add(g.name);
  }
  const unresolvedNames = new Set<string>();
  for (const name of allNames) {
    const res = index.resolve(name);
    if (res.status === 'ambiguous') {
      issues.push({
        row: 0,
        message: `Name "${name}" ist mehrdeutig (${res.candidates.length} Treffer: ${res.candidates.map((c) => `${c.kind}:${c.id}`).join(', ')}) — über --aliases auflösen`,
        blocking: true,
      });
    } else if (res.status === 'unresolved') {
      unresolvedNames.add(name);
    }
  }

  // Duplicate check (§3.7): same group + date (day) + hall + both scores
  // already present as a *played* fixture with a recorded result.
  const existingFixtures = await payload.find({
    collection: 'fixtures',
    where: { group: { equals: opts.groupId }, status: { equals: 'played' } },
    pagination: false,
    depth: 1,
    overrideAccess: true,
  });
  const fixtureIds = existingFixtures.docs.map((f) => f.id);
  const existingResults =
    fixtureIds.length > 0
      ? await payload.find({
          collection: 'matchResults',
          where: { fixture: { in: fixtureIds } },
          pagination: false,
          depth: 0,
          overrideAccess: true,
        })
      : { docs: [] as { fixture: unknown; redScore: number; greenScore: number }[] };
  const resultByFixtureId = new Map(
    existingResults.docs.map((r) => [String(typeof r.fixture === 'object' && r.fixture !== null ? (r.fixture as { id: unknown }).id : r.fixture), r]),
  );

  const isDuplicate = (row: ParsedFixtureRow) =>
    existingFixtures.docs.some((f) => {
      const hallName = typeof f.hall === 'object' && f.hall !== null ? String((f.hall as { name: unknown }).name) : undefined;
      if (!hallName || hallName.trim().toLowerCase() !== row.hallName.toLowerCase()) return false;
      const fDate = new Date(f.date as string);
      const rDate = new Date(row.dateIso);
      if (
        fDate.getUTCFullYear() !== rDate.getUTCFullYear() ||
        fDate.getUTCMonth() !== rDate.getUTCMonth() ||
        fDate.getUTCDate() !== rDate.getUTCDate()
      ) {
        return false;
      }
      const result = resultByFixtureId.get(String(f.id));
      return Boolean(result && result.redScore === row.redScore && result.greenScore === row.greenScore);
    });

  const duplicateRowNums = new Set(rows.filter(isDuplicate).map((r) => r.rowNum));
  for (const rowNum of duplicateRowNums) {
    issues.push({
      row: rowNum,
      message: 'Mögliches Duplikat: gleiche Halle/Datum/Ergebnis existiert bereits — wird übersprungen (mit --force-duplicates trotzdem importieren)',
      blocking: false,
    });
  }

  const blockingCount = issues.filter((i) => i.blocking).length;
  const preview: ImportPreview = {
    kind: 'fixtures',
    fileName: opts.fileName,
    totalRows: rows.length,
    issues,
    canCommit: blockingCount === 0,
    summary: [
      `${rows.length} Zeile(n) erkannt.`,
      unresolvedNames.size > 0
        ? `${unresolvedNames.size} unbekannte Name(n) werden beim Commit als neue "Ehemalige Spieler" angelegt: ${[...unresolvedNames].join(', ')}`
        : 'Alle Namen aufgelöst.',
      duplicateRowNums.size > 0 ? `${duplicateRowNums.size} mögliche Duplikat(e) gefunden.` : 'Keine Duplikate gefunden.',
      `${blockingCount} blockierende(s) Problem(e).`,
    ],
  };

  if (opts.dryRun || !preview.canCommit) {
    return { preview };
  }

  const importBatch = await payload.create({
    collection: 'importBatches',
    data: { group: opts.groupId, kind: 'fixtures', fileName: opts.fileName, uploadedBy: opts.uploadedBy, status: 'draft', rowCount: rows.length },
    overrideAccess: true,
  });

  const changeLog: FixturesChangeLog = {
    kind: 'fixtures',
    createdFixtureIds: [],
    createdLineupIds: [],
    createdMatchResultIds: [],
    createdHallIds: [],
    createdSeasonIds: [],
    createdLegacyPlayerIds: [],
    affectedPlayers: [],
    affectedSeasonIds: [],
  };
  const skipped: { row: number; reason: string }[] = [];
  const affectedByKey = new Map<string, PlayerRef>();
  const affectedSeasonIds = new Set<string | number>();
  const hallCache = new Map<string, { id: string | number }>();
  const seasonCache = new Map<string, { id: string | number }>();

  const resolveOrCreate = async (name: string): Promise<ResolvedPlayer> => {
    const res = index.resolve(name);
    if (res.status === 'resolved') return res.player;
    // Ambiguous names were already blocking at preview time — unreachable here.
    const legacy = await payload.create({
      collection: 'legacyPlayers',
      data: { group: opts.groupId, name, note: 'Automatisch angelegt beim Import (fixtures.csv)' },
      overrideAccess: true,
    });
    changeLog.createdLegacyPlayerIds.push(legacy.id);
    const player: ResolvedPlayer = { kind: 'legacyPlayers', id: legacy.id, name };
    index.remember(name, player);
    return player;
  };

  try {
    for (const row of rows) {
      if (duplicateRowNums.has(row.rowNum) && !opts.forceDuplicates) {
        skipped.push({ row: row.rowNum, reason: 'Duplikat übersprungen' });
        continue;
      }

      let hall = hallCache.get(row.hallName.toLowerCase());
      if (!hall) {
        const { doc, created } = await findOrCreateHall(payload, opts.groupId, row.hallName);
        if (created) changeLog.createdHallIds.push(doc.id);
        hall = doc;
        hallCache.set(row.hallName.toLowerCase(), doc);
      }

      let season = seasonCache.get(row.seasonLabel.toLowerCase());
      if (!season) {
        const { doc, created } = await findOrCreateSeason(payload, opts.groupId, row.seasonLabel);
        if (created) changeLog.createdSeasonIds.push(doc.id);
        season = doc;
        seasonCache.set(row.seasonLabel.toLowerCase(), doc);
      }
      affectedSeasonIds.add(season.id);

      const redEntries = new Map<string, { player: ResolvedPlayer; count: number }>();
      for (const g of row.redGoals) {
        const player = await resolveOrCreate(g.name);
        const k = refKey(player);
        redEntries.set(k, { player, count: (redEntries.get(k)?.count ?? 0) + g.count });
      }
      const greenEntries = new Map<string, { player: ResolvedPlayer; count: number }>();
      for (const g of row.greenGoals) {
        const player = await resolveOrCreate(g.name);
        const k = refKey(player);
        greenEntries.set(k, { player, count: (greenEntries.get(k)?.count ?? 0) + g.count });
      }
      const mvpPlayer = row.mvpName ? await resolveOrCreate(row.mvpName) : undefined;

      const fixture = await payload.create({
        collection: 'fixtures',
        data: { group: opts.groupId, season: season.id, date: row.dateIso, time: row.time, hall: hall.id, status: 'played' },
        overrideAccess: true,
      });
      changeLog.createdFixtureIds.push(fixture.id);

      const lineup = await payload.create({
        collection: 'lineups',
        data: {
          fixture: fixture.id,
          redPlayers: [...redEntries.values()].map((e) => polyRef(e.player.kind, e.player.id)),
          greenPlayers: [...greenEntries.values()].map((e) => polyRef(e.player.kind, e.player.id)),
        },
        overrideAccess: true,
      });
      changeLog.createdLineupIds.push(lineup.id);

      const goals = [
        ...[...redEntries.values()].map((e) => ({ player: polyRef(e.player.kind, e.player.id), team: 'red' as const, count: e.count })),
        ...[...greenEntries.values()].map((e) => ({ player: polyRef(e.player.kind, e.player.id), team: 'green' as const, count: e.count })),
      ];

      const matchResult = await payload.create({
        collection: 'matchResults',
        data: {
          fixture: fixture.id,
          redScore: row.redScore,
          greenScore: row.greenScore,
          redOwnGoals: row.redOwnGoals,
          greenOwnGoals: row.greenOwnGoals,
          mvp: mvpPlayer ? polyRef(mvpPlayer.kind, mvpPlayer.id) : undefined,
          goals,
          source: 'import',
          importBatch: importBatch.id,
        },
        overrideAccess: true,
      });
      changeLog.createdMatchResultIds.push(matchResult.id);

      for (const e of [...redEntries.values(), ...greenEntries.values()]) {
        affectedByKey.set(refKey(e.player), e.player);
      }
    }
  } catch (err) {
    changeLog.affectedPlayers = [...affectedByKey.values()];
    changeLog.affectedSeasonIds = [...affectedSeasonIds];
    await payload.update({
      collection: 'importBatches',
      id: importBatch.id,
      data: { errorLog: { issues, skipped, fatalError: err instanceof Error ? err.message : String(err) }, changeLog },
      overrideAccess: true,
    });
    throw new Error(
      `Import fixtures fehlgeschlagen nach ${changeLog.createdFixtureIds.length} geschriebenen Zeile(n) (Batch ${importBatch.id} bleibt im Status "draft" — mit rollback aufräumen): ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  changeLog.affectedPlayers = [...affectedByKey.values()];
  changeLog.affectedSeasonIds = [...affectedSeasonIds];

  if (changeLog.affectedPlayers.length > 0) {
    if (changeLog.affectedSeasonIds.length > 0) {
      for (const seasonId of changeLog.affectedSeasonIds) {
        // eslint-disable-next-line no-await-in-loop -- small, bounded set of seasons touched by one historic import run.
        await recomputeStatsForPlayers(payload, { groupId: opts.groupId, seasonId, players: changeLog.affectedPlayers });
      }
    } else {
      await recomputeStatsForPlayers(payload, { groupId: opts.groupId, players: changeLog.affectedPlayers });
    }
  }

  await payload.update({
    collection: 'importBatches',
    id: importBatch.id,
    data: { status: 'committed', rowCount: rows.length - skipped.length, errorLog: { issues, skipped }, changeLog },
    overrideAccess: true,
  });

  return {
    preview,
    commit: { importBatchId: importBatch.id, rowsWritten: rows.length - skipped.length, skipped, changeLog },
  };
}
