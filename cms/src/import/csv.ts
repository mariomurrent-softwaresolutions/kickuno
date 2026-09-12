/**
 * Minimal RFC4180-ish CSV parser — hand-rolled specifically to avoid
 * pulling in an npm dependency for what's essentially a one-time (or
 * occasional "found an old spreadsheet") CLI import (implementation-plan.md
 * §3.7, phase 6). Handles quoted fields (embedded commas, embedded
 * newlines, and `""` as an escaped quote), `\r\n`/`\n` line endings, and a
 * header row. Not a general-purpose CSV library — no configurable
 * delimiter, no streaming, whole file read into memory — which is fine for
 * the row counts a Hallenkick group's historic spreadsheet realistically
 * has (hundreds of matches at most, not millions).
 */

/** Parses `text` into an array of header-keyed row objects. Blank trailing lines are skipped. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows = parseRows(text);
  if (rows.length === 0) return [];

  const header = rows[0].map((h) => h.trim());
  return rows
    .slice(1)
    .filter((row) => row.some((cell) => cell.trim() !== ''))
    .map((row) => {
      const obj: Record<string, string> = {};
      header.forEach((key, i) => {
        obj[key] = (row[i] ?? '').trim();
      });
      return obj;
    });
}

function parseRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const n = text.length;

  const pushField = () => {
    row.push(field);
    field = '';
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };

  while (i < n) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += c;
      i += 1;
      continue;
    }

    if (c === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (c === ',') {
      pushField();
      i += 1;
      continue;
    }
    if (c === '\r') {
      i += 1; // swallow — the following \n (or EOF) ends the row
      continue;
    }
    if (c === '\n') {
      pushRow();
      i += 1;
      continue;
    }
    field += c;
    i += 1;
  }
  // Last row, when the file has no trailing newline.
  if (field !== '' || row.length > 0) pushRow();

  return rows;
}

/**
 * `Name:count;Name:count` → `[{name, count}]`, as used by `fixtures.csv`'s
 * `redGoals`/`greenGoals` columns (§3.7). Trims whitespace, skips empty
 * segments (trailing `;`), defaults a missing/invalid count to 1 rather
 * than dropping the entry (a bare `Name` with no `:count` almost certainly
 * means "scored once").
 */
export function parseGoalList(raw: string): { name: string; count: number }[] {
  if (!raw.trim()) return [];
  return raw
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => {
      const idx = part.lastIndexOf(':');
      if (idx === -1) return { name: part.trim(), count: 1 };
      const name = part.slice(0, idx).trim();
      const countRaw = part.slice(idx + 1).trim();
      const count = Number.parseInt(countRaw, 10);
      return { name, count: Number.isFinite(count) && count > 0 ? count : 1 };
    })
    .filter((g) => g.name.length > 0);
}

/**
 * Parses a date cell in either `YYYY-MM-DD` or German `DD.MM.YYYY` form to
 * an ISO date string (midnight UTC) — the two formats a spreadsheet export
 * of a German group's history realistically comes in. Returns `undefined`
 * if neither pattern matches.
 */
export function parseDateCell(raw: string): string | undefined {
  const trimmed = raw.trim();

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (iso) {
    const [, y, m, d] = iso;
    const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }

  const de = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(trimmed);
  if (de) {
    const [, d, m, y] = de;
    const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }

  return undefined;
}
