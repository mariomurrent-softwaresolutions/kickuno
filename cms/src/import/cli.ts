import fs from 'node:fs';
import path from 'node:path';

import { runCareerBaselineImport } from './career-baseline';
import { runFixturesImport } from './fixtures';
import { runLegacyPlayersImport } from './legacy-players';
import { rollbackImportBatch } from './rollback';
import type { PlayerAliasMap } from './resolve';
import type { ImportPreview } from './types';

/**
 * CLI entry point for the historic-data import service —
 * implementation-plan.md §3.7 recommends shipping this CLI-only first and
 * only building the `/admin/import` page if more spreadsheets are expected
 * to surface after go-live (a one-time backfill doesn't justify the UI
 * work on its own).
 *
 * Usage (from the `cms/` workspace):
 *
 *   npm run import:run -- --kind=fixtures --group=<id> --file=./history.csv [--dry-run] [--force-duplicates] [--aliases=./aliases.json] [--uploaded-by=<userId>]
 *   npm run import:run -- --kind=career-baseline --group=<id> --file=./baseline.csv [--dry-run] [--aliases=./aliases.json]
 *   npm run import:run -- --kind=legacy-players --group=<id> --file=./legacy.csv [--dry-run] [--aliases=./aliases.json]
 *   npm run import:run -- --kind=rollback --batch=<importBatchId>
 *
 * Always run once with `--dry-run` first — it parses, resolves names, and
 * runs the duplicate check, but writes nothing. Without `--dry-run`, a run
 * with zero blocking issues commits immediately; a run with any blocking
 * issue (an ambiguous name, an unparseable required field) writes nothing
 * and exits non-zero, same as `--dry-run` would have reported.
 *
 * `--aliases=./aliases.json` is the escape hatch for a name the automatic
 * index can't place: `{ "Exact CSV Name": { "kind": "users"|"legacyPlayers", "id": "..." } }`
 * (see `resolve.ts`'s `PlayerAliasMap` doc comment).
 */

// Loads `cms/.env` before `payload.config` is imported (dynamically, below)
// — payload.config reads DATABASE_URI/PAYLOAD_SECRET from `process.env` the
// moment it's evaluated, so this has to run first. A plain top-level
// statement (unlike an `import`) runs in source order, so putting this
// ahead of the dynamic imports in `main()` is enough.
try {
  process.loadEnvFile(path.resolve(import.meta.dirname, '../../.env'));
} catch {
  // .env is optional — fine if DATABASE_URI/PAYLOAD_SECRET are already set (CI, etc.).
}

type Args = Record<string, string | boolean>;

function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (const raw of argv) {
    if (!raw.startsWith('--')) continue;
    const eq = raw.indexOf('=');
    if (eq === -1) args[raw.slice(2)] = true;
    else args[raw.slice(2, eq)] = raw.slice(eq + 1);
  }
  return args;
}

function requireString(args: Args, key: string): string {
  const v = args[key];
  if (typeof v !== 'string' || v.length === 0) throw new Error(`--${key}=... ist erforderlich`);
  return v;
}

function printPreview(preview: ImportPreview) {
  console.log(`\n=== Vorschau: ${preview.kind} (${preview.fileName}) ===`);
  preview.summary.forEach((line) => console.log(line));
  if (preview.issues.length > 0) {
    console.log('\nProbleme:');
    preview.issues.forEach((i) => console.log(`  [${i.blocking ? 'BLOCKIEREND' : 'Hinweis'}] Zeile ${i.row}: ${i.message}`));
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const kind = requireString(args, 'kind');

  const { getPayload } = await import('payload');
  const configModule = await import('../payload.config');
  const payload = await getPayload({ config: configModule.default });

  if (kind === 'rollback') {
    const batchId = requireString(args, 'batch');
    const result = await rollbackImportBatch(payload, batchId);
    console.log(`Batch ${batchId} zurückgerollt.`);
    result.note.forEach((n) => console.log(`  - ${n}`));
    return;
  }

  const groupId = requireString(args, 'group');
  const filePath = requireString(args, 'file');
  const dryRun = Boolean(args['dry-run']);
  const forceDuplicates = Boolean(args['force-duplicates']);
  const aliasesPath = typeof args.aliases === 'string' ? args.aliases : undefined;
  const uploadedBy = typeof args['uploaded-by'] === 'string' ? args['uploaded-by'] : undefined;

  const csvText = fs.readFileSync(path.resolve(process.cwd(), filePath), 'utf-8');
  const aliases: PlayerAliasMap = aliasesPath
    ? JSON.parse(fs.readFileSync(path.resolve(process.cwd(), aliasesPath), 'utf-8'))
    : {};
  const fileName = path.basename(filePath);

  const result =
    kind === 'fixtures'
      ? await runFixturesImport(payload, { groupId, fileName, csvText, aliases, dryRun, forceDuplicates, uploadedBy })
      : kind === 'career-baseline'
        ? await runCareerBaselineImport(payload, { groupId, fileName, csvText, aliases, dryRun, uploadedBy })
        : kind === 'legacy-players'
          ? await runLegacyPlayersImport(payload, { groupId, fileName, csvText, aliases, dryRun, uploadedBy })
          : (() => {
              throw new Error(`Unbekannter --kind "${kind}" (erwartet: fixtures | career-baseline | legacy-players | rollback)`);
            })();

  printPreview(result.preview);

  if (result.commit) {
    console.log(`\nCommit abgeschlossen — Batch ${result.commit.importBatchId}, ${result.commit.rowsWritten} Zeile(n) geschrieben, ${result.commit.skipped.length} übersprungen.`);
    result.commit.skipped.forEach((s) => console.log(`  - Zeile ${s.row}: ${s.reason}`));
  } else if (!dryRun) {
    console.error('\nCommit abgebrochen — blockierende Probleme siehe oben. Nichts wurde geschrieben.');
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
