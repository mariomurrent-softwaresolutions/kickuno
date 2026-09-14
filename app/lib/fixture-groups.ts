import type { ApiFixture } from './api';

export const WEEKDAYS = ['SO', 'MO', 'DI', 'MI', 'DO', 'FR', 'SA'];
export const MONTHS_LONG = [
  'Januar',
  'Februar',
  'März',
  'April',
  'Mai',
  'Juni',
  'Juli',
  'August',
  'September',
  'Oktober',
  'November',
  'Dezember',
];

export function fixtureDateParts(iso: string) {
  const d = new Date(iso);
  return { weekday: WEEKDAYS[d.getUTCDay()], day: String(d.getUTCDate()).padStart(2, '0') };
}

export type FixtureGroup = { key: string; label: string; fixtures: ApiFixture[] };

/**
 * Buckets an already-date-sorted fixture list into contiguous per-month
 * runs (a single pass is enough since a sorted list never revisits a
 * month once it's moved past it, in either direction — upcoming ascending,
 * past reversed to descending, both still monotonic). The month label
 * drops the year for the current year and shows it otherwise, since a
 * season spans a calendar-year boundary (§1) and the list can otherwise
 * read as ambiguous around New Year's.
 *
 * Shared between the main Termine list and the per-season Termine list
 * (`(tabs)/termine/saison/[seasonId].tsx`) — both group the same way.
 */
export function groupFixturesByMonth(fixtures: ApiFixture[]): FixtureGroup[] {
  const currentYear = new Date().getUTCFullYear();
  const groups: FixtureGroup[] = [];
  for (const fixture of fixtures) {
    const d = new Date(fixture.date);
    const year = d.getUTCFullYear();
    const month = d.getUTCMonth();
    const key = `${year}-${month}`;
    const last = groups[groups.length - 1];
    if (last?.key === key) {
      last.fixtures.push(fixture);
    } else {
      const label = year === currentYear ? MONTHS_LONG[month] : `${MONTHS_LONG[month]} ${year}`;
      groups.push({ key, label, fixtures: [fixture] });
    }
  }
  return groups;
}
