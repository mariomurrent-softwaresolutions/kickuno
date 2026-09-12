import type { Payload } from 'payload';

import { polyId, polyKind, polyRef } from '../lib/polymorphic';
import { parseCsv, parseDateCell } from './csv';
import { buildPlayerIndex, type PlayerAliasMap, type ResolvedPlayer } from './resolve';
import type { CareerBaselineChangeLog, CommitResult, ImportIssue, ImportPreview } from './types';

/**
 * Path B of implementation-plan.md §3.7 — `career-baseline.csv`: lump-sum
 * lifetime totals for a group with no match-by-match history (or history
 * older than what path A's spreadsheet covers). Columns: `name, played,
 * wins, draws, losses, goals, ownGoals, mvps, goalDiff, memberSince`. Each
 * row **sets** (not adds to — re-running the same file stays idempotent)
 * `playerCareerStats.baseline*` for that player; `matchPlayed`/etc. are
 * left untouched so anything already recorded via real `matchResults` (live
 * or path-A-imported) keeps adding on top, per §3.1's "all-time total =
 * baseline* + match*". Never touches `playerSeasonStats` — there's no
 * meaningful "season" for a lump-sum total (§3.7).
 *
 * `memberSince` only ever updates a resolved **`users`** row (overriding
 * their sign-up-time default with the real historic join date, so
 * Spielerprofil's "seit {year}" is accurate) — `legacyPlayers` has no such
 * field, so the column is silently a no-op for a name that resolves (or
 * gets created) as a legacy player. Documented, not a bug: revisit only if
 * `legacyPlayers` grows a `memberSince` field of its own.
 */

type ParsedBaselineRow = {
  rowNum: number;
  name: string;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goals: number;
  ownGoals: number;
  mvps: number;
  goalDiff: number;
  memberSinceIso?: string;
};

function toNumberOr(raw: string | undefined, fallback: number): number | undefined {
  const trimmed = (raw ?? '').trim();
  if (trimmed === '') return fallback;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : undefined;
}

function parseRows(csvText: string, issues: ImportIssue[]): ParsedBaselineRow[] {
  const raw = parseCsv(csvText);
  const rows: ParsedBaselineRow[] = [];

  raw.forEach((r, i) => {
    const rowNum = i + 1;
    if (!r.name?.trim()) {
      issues.push({ row: rowNum, message: 'Name fehlt', blocking: true });
      return;
    }

    const fields: Record<string, number> = {};
    let ok = true;
    for (const col of ['played', 'wins', 'draws', 'losses', 'goals', 'ownGoals', 'mvps', 'goalDiff'] as const) {
      const n = toNumberOr(r[col], 0);
      if (n === undefined) {
        issues.push({ row: rowNum, message: `Ungültiger Wert in Spalte "${col}": "${r[col]}"`, blocking: true });
        ok = false;
        break;
      }
      fields[col] = n;
    }
    if (!ok) return;

    let memberSinceIso: string | undefined;
    if (r.memberSince?.trim()) {
      memberSinceIso = parseDateCell(r.memberSince);
      if (!memberSinceIso) {
        issues.push({ row: rowNum, message: `Ungültiges memberSince-Datum: "${r.memberSince}" — Spalte wird ignoriert`, blocking: false });
      }
    }

    rows.push({
      rowNum,
      name: r.name.trim(),
      played: fields.played,
      wins: fields.wins,
      draws: fields.draws,
      losses: fields.losses,
      goals: fields.goals,
      ownGoals: fields.ownGoals,
      mvps: fields.mvps,
      goalDiff: fields.goalDiff,
      memberSinceIso,
    });
  });

  return rows;
}

export async function runCareerBaselineImport(
  payload: Payload,
  opts: {
    groupId: string | number;
    fileName: string;
    csvText: string;
    aliases?: PlayerAliasMap;
    dryRun: boolean;
    uploadedBy?: string | number;
  },
): Promise<{ preview: ImportPreview; commit?: CommitResult }> {
  const issues: ImportIssue[] = [];
  const rows = parseRows(opts.csvText, issues);
  const index = await buildPlayerIndex(payload, opts.groupId, opts.aliases ?? {});

  const unresolvedNames = new Set<string>();
  for (const row of rows) {
    const res = index.resolve(row.name);
    if (res.status === 'ambiguous') {
      issues.push({
        row: row.rowNum,
        message: `Name "${row.name}" ist mehrdeutig (${res.candidates.length} Treffer: ${res.candidates.map((c) => `${c.kind}:${c.id}`).join(', ')}) — über --aliases auflösen`,
        blocking: true,
      });
    } else if (res.status === 'unresolved') {
      unresolvedNames.add(row.name);
    }
  }

  const blockingCount = issues.filter((i) => i.blocking).length;
  const preview: ImportPreview = {
    kind: 'career-baseline',
    fileName: opts.fileName,
    totalRows: rows.length,
    issues,
    canCommit: blockingCount === 0,
    summary: [
      `${rows.length} Zeile(n) erkannt.`,
      unresolvedNames.size > 0
        ? `${unresolvedNames.size} unbekannte Name(n) werden beim Commit als neue "Ehemalige Spieler" angelegt: ${[...unresolvedNames].join(', ')}`
        : 'Alle Namen aufgelöst.',
      `${blockingCount} blockierende(s) Problem(e).`,
    ],
  };

  if (opts.dryRun || !preview.canCommit) {
    return { preview };
  }

  const importBatch = await payload.create({
    collection: 'importBatches',
    data: { group: opts.groupId, kind: 'career-baseline', fileName: opts.fileName, uploadedBy: opts.uploadedBy, status: 'draft', rowCount: rows.length },
    overrideAccess: true,
  });

  const changeLog: CareerBaselineChangeLog = { kind: 'career-baseline', playerUpdates: [], memberSinceUpdates: [] };
  const skipped: { row: number; reason: string }[] = [];

  const { docs: existingCareerDocs } = await payload.find({
    collection: 'playerCareerStats',
    where: { group: { equals: opts.groupId } },
    pagination: false,
    depth: 0,
    overrideAccess: true,
  });
  const careerByKey = new Map<string, (typeof existingCareerDocs)[number]>();
  for (const doc of existingCareerDocs) {
    const id = polyId(doc.player);
    const kind = polyKind(doc.player);
    if (id !== undefined && kind) careerByKey.set(`${kind}:${id}`, doc);
  }

  try {
    for (const row of rows) {
      const res = index.resolve(row.name);
      let player: ResolvedPlayer;
      let createdLegacyPlayerId: string | number | undefined;
      if (res.status === 'resolved') {
        player = res.player;
      } else {
        const legacy = await payload.create({
          collection: 'legacyPlayers',
          data: { group: opts.groupId, name: row.name, note: 'Automatisch angelegt beim Import (career-baseline.csv)' },
          overrideAccess: true,
        });
        player = { kind: 'legacyPlayers', id: legacy.id, name: row.name };
        createdLegacyPlayerId = legacy.id;
        index.remember(row.name, player);
      }

      const key = `${player.kind}:${player.id}`;
      const existing = careerByKey.get(key);
      const data = {
        player: polyRef(player.kind, player.id),
        group: opts.groupId,
        baselinePlayed: row.played,
        baselineWins: row.wins,
        baselineDraws: row.draws,
        baselineLosses: row.losses,
        baselineGoals: row.goals,
        baselineOwnGoals: row.ownGoals,
        baselineMvps: row.mvps,
        baselineGoalDiff: row.goalDiff,
      };

      let careerStatsId: string | number;
      if (existing) {
        await payload.update({ collection: 'playerCareerStats', id: existing.id, data, overrideAccess: true });
        careerStatsId = existing.id;
        changeLog.playerUpdates.push({
          player,
          careerStatsId,
          createdLegacyPlayerId,
          priorBaseline: {
            baselinePlayed: (existing.baselinePlayed as number) ?? 0,
            baselineWins: (existing.baselineWins as number) ?? 0,
            baselineDraws: (existing.baselineDraws as number) ?? 0,
            baselineLosses: (existing.baselineLosses as number) ?? 0,
            baselineGoals: (existing.baselineGoals as number) ?? 0,
            baselineOwnGoals: (existing.baselineOwnGoals as number) ?? 0,
            baselineMvps: (existing.baselineMvps as number) ?? 0,
            baselineGoalDiff: (existing.baselineGoalDiff as number) ?? 0,
          },
        });
      } else {
        const created = await payload.create({ collection: 'playerCareerStats', data, overrideAccess: true });
        careerStatsId = created.id;
        changeLog.playerUpdates.push({ player, careerStatsId, createdLegacyPlayerId, priorBaseline: null });
      }
      careerByKey.set(key, { ...(existing ?? {}), ...data, id: careerStatsId } as (typeof existingCareerDocs)[number]);

      if (player.kind === 'users' && row.memberSinceIso) {
        const user = await payload.findByID({ collection: 'users', id: player.id, depth: 0, overrideAccess: true });
        changeLog.memberSinceUpdates.push({ userId: player.id, priorMemberSince: (user.memberSince as string | undefined) ?? null });
        await payload.update({ collection: 'users', id: player.id, data: { memberSince: row.memberSinceIso }, overrideAccess: true });
      }
    }
  } catch (err) {
    await payload.update({
      collection: 'importBatches',
      id: importBatch.id,
      data: { errorLog: { issues, skipped, fatalError: err instanceof Error ? err.message : String(err) }, changeLog },
      overrideAccess: true,
    });
    throw new Error(
      `Import career-baseline fehlgeschlagen nach ${changeLog.playerUpdates.length} geschriebenen Zeile(n) (Batch ${importBatch.id} bleibt im Status "draft" — mit rollback aufräumen): ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  await payload.update({
    collection: 'importBatches',
    id: importBatch.id,
    data: { status: 'committed', rowCount: rows.length, errorLog: { issues, skipped }, changeLog },
    overrideAccess: true,
  });

  return { preview, commit: { importBatchId: importBatch.id, rowsWritten: rows.length, skipped, changeLog } };
}
