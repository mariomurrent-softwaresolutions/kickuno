import type { ApiFixture } from './api';
import i18n from './i18n';

const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
const MONTH_KEYS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'] as const;

export function fixtureDateParts(iso: string) {
  const d = new Date(iso);
  return {
    weekday: i18n.t(`common:weekdaysShort.${WEEKDAY_KEYS[d.getUTCDay()]}`),
    day: String(d.getUTCDate()).padStart(2, '0'),
  };
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
      const monthLabel = i18n.t(`common:monthsLong.${MONTH_KEYS[month]}`);
      const label = year === currentYear ? monthLabel : `${monthLabel} ${year}`;
      groups.push({ key, label, fixtures: [fixture] });
    }
  }
  return groups;
}
