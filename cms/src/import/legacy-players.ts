import type { Payload } from 'payload';

import { parseCsv } from './csv';
import { buildPlayerIndex, type PlayerAliasMap } from './resolve';
import type { CommitResult, ImportIssue, ImportPreview, LegacyPlayersChangeLog } from './types';

const VALID_POSITIONS = new Set(['tor', 'abwehr', 'mitte', 'sturm']);

/**
 * Either-path helper of implementation-plan.md §3.7 — `legacy-players.csv`:
 * ghost-profile-only rows for people who no longer belong to the group and
 * have no imported match history at all (no stats, just a name to show
 * alongside real members in old context — e.g. referenced from a manually
 * written note elsewhere). Columns: `name, position, note`.
 *
 * A name that already resolves to a current **member** is left alone
 * (skipped, not duplicated as a ghost) — that would be a real account
 * shadowed by a fake one. A name that already resolves to an existing
 * `legacyPlayers` row is not duplicated either; instead this only fills in
 * `position`/`note` on the existing row where the CSV has a value and the
 * row was blank, never overwriting something already set.
 */

type ParsedRow = { rowNum: number; name: string; position?: string; note?: string };

function parseRows(csvText: string, issues: ImportIssue[]): ParsedRow[] {
  const raw = parseCsv(csvText);
  const rows: ParsedRow[] = [];

  raw.forEach((r, i) => {
    const rowNum = i + 1;
    if (!r.name?.trim()) {
      issues.push({ row: rowNum, message: 'Name fehlt', blocking: true });
      return;
    }
    let position: string | undefined;
    if (r.position?.trim()) {
      const normalized = r.position.trim().toLowerCase();
      if (VALID_POSITIONS.has(normalized)) {
        position = normalized;
      } else {
        issues.push({ row: rowNum, message: `Unbekannte Position "${r.position}" — Spalte wird ignoriert`, blocking: false });
      }
    }
    rows.push({ rowNum, name: r.name.trim(), position, note: r.note?.trim() || undefined });
  });

  return rows;
}

export async function runLegacyPlayersImport(
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

  let newCount = 0;
  let existingMemberCount = 0;
  let existingLegacyCount = 0;
  for (const row of rows) {
    const res = index.resolve(row.name);
    if (res.status === 'ambiguous') {
      issues.push({
        row: row.rowNum,
        message: `Name "${row.name}" ist mehrdeutig (${res.candidates.length} Treffer) — über --aliases auflösen`,
        blocking: true,
      });
    } else if (res.status === 'resolved' && res.player.kind === 'users') {
      existingMemberCount += 1;
    } else if (res.status === 'resolved' && res.player.kind === 'legacyPlayers') {
      existingLegacyCount += 1;
    } else {
      newCount += 1;
    }
  }

  const blockingCount = issues.filter((i) => i.blocking).length;
  const preview: ImportPreview = {
    kind: 'legacy-players',
    fileName: opts.fileName,
    totalRows: rows.length,
    issues,
    canCommit: blockingCount === 0,
    summary: [
      `${rows.length} Zeile(n) erkannt.`,
      `${newCount} neue "Ehemalige Spieler" werden angelegt.`,
      existingMemberCount > 0 ? `${existingMemberCount} Name(n) sind bereits aktive Mitglieder — werden übersprungen.` : '',
      existingLegacyCount > 0 ? `${existingLegacyCount} Name(n) existieren bereits als "Ehemalige Spieler" — nur fehlende Felder werden ergänzt.` : '',
      `${blockingCount} blockierende(s) Problem(e).`,
    ].filter(Boolean),
  };

  if (opts.dryRun || !preview.canCommit) {
    return { preview };
  }

  const importBatch = await payload.create({
    collection: 'importBatches',
    data: { group: opts.groupId, kind: 'legacy-players', fileName: opts.fileName, uploadedBy: opts.uploadedBy, status: 'draft', rowCount: rows.length },
    overrideAccess: true,
  });

  const changeLog: LegacyPlayersChangeLog = { kind: 'legacy-players', createdLegacyPlayerIds: [], updatedLegacyPlayers: [] };
  const skipped: { row: number; reason: string }[] = [];

  try {
    for (const row of rows) {
      const res = index.resolve(row.name);
      if (res.status === 'resolved' && res.player.kind === 'users') {
        skipped.push({ row: row.rowNum, reason: `"${row.name}" ist bereits aktives Mitglied` });
        continue;
      }

      if (res.status === 'resolved' && res.player.kind === 'legacyPlayers') {
        const existing = await payload.findByID({ collection: 'legacyPlayers', id: res.player.id, depth: 0, overrideAccess: true });
        const patch: Record<string, string> = {};
        if (row.position && !existing.position) patch.position = row.position;
        if (row.note && !existing.note) patch.note = row.note;
        if (Object.keys(patch).length > 0) {
          changeLog.updatedLegacyPlayers.push({
            id: existing.id,
            priorPosition: (existing.position as string | undefined) ?? null,
            priorNote: (existing.note as string | undefined) ?? null,
          });
          await payload.update({ collection: 'legacyPlayers', id: existing.id, data: patch, overrideAccess: true });
        } else {
          skipped.push({ row: row.rowNum, reason: `"${row.name}" existiert bereits als Ehemalige(r) Spieler(in) — nichts zu ergänzen` });
        }
        continue;
      }

      const created = await payload.create({
        collection: 'legacyPlayers',
        data: { group: opts.groupId, name: row.name, position: row.position, note: row.note },
        overrideAccess: true,
      });
      changeLog.createdLegacyPlayerIds.push(created.id);
      index.remember(row.name, { kind: 'legacyPlayers', id: created.id, name: row.name });
    }
  } catch (err) {
    await payload.update({
      collection: 'importBatches',
      id: importBatch.id,
      data: { errorLog: { issues, skipped, fatalError: err instanceof Error ? err.message : String(err) }, changeLog },
      overrideAccess: true,
    });
    throw new Error(
      `Import legacy-players fehlgeschlagen (Batch ${importBatch.id} bleibt im Status "draft" — mit rollback aufräumen): ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  await payload.update({
    collection: 'importBatches',
    id: importBatch.id,
    data: { status: 'committed', rowCount: rows.length - skipped.length, errorLog: { issues, skipped }, changeLog },
    overrideAccess: true,
  });

  return { preview, commit: { importBatchId: importBatch.id, rowsWritten: rows.length - skipped.length, skipped, changeLog } };
}
