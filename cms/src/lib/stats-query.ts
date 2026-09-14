import type { Payload } from 'payload';

import { polyId, polyKind, polyRefs, type PolyKind } from './polymorphic';

export type MatchOutcome = 'win' | 'draw' | 'loss';

export type PlayerMatchRecord = {
  fixtureId: string | number;
  date: string;
  outcome: MatchOutcome;
  goals: number;
  mvp: boolean;
  goalDiff: number;
};

export type PlayerStatsRow = {
  playerId: string;
  /** 'users' for a real member, 'legacyPlayers' for an imported "ghost" profile (§3.7, phase 6) — tells the app which profile endpoint/route to use. */
  playerKind: PolyKind;
  name: string;
  initials?: string;
  position?: string;
  memberSince?: string;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goals: number;
  /** Always 0 for now — matchResults has no per-player own-goal attribution. See stats.ts. */
  ownGoals: number;
  mvps: number;
  goalDiff: number;
  /** Chronological, oldest first. */
  matches: PlayerMatchRecord[];
};

const key = (id: string | number, kind: PolyKind) => `${kind}:${id}`;

/**
 * Every current member of `groupId` PLUS every `legacyPlayers` "ghost"
 * profile in the group (§3.7, phase 6 — a legacy player's imported matches
 * are just as real as a live member's), with their full match history for
 * the requested scope (`seasonId` set = that season only, `undefined` =
 * career/all-time) — implementation-plan.md §6. Same 3-query shape as
 * `recomputeStatsForPlayers` in `stats.ts`, but for the whole roster rather
 * than a handful of affected players, and keeping the per-match sequence
 * (needed for "Serie" and the last-5 form strip) instead of folding
 * straight into totals.
 *
 * For `scope: alltime` (`seasonId` omitted), each row's totals are the
 * match-derived numbers here PLUS that player's `playerCareerStats.
 * baseline*` (§3.7 path B — a lump-sum legacy import with no per-match
 * detail) — "all-time totals shown in the app = baseline* + match*", per
 * the plan. Baseline never applies to a season row (there's no meaningful
 * season for a lump-sum legacy total).
 *
 * A member who left the group after playing (and was never captured as a
 * `legacyPlayers` row) drops out of this list entirely — that's the
 * remaining gap once phase 6 exists: leaving the group with no import to
 * back-fill a ghost profile still loses their history from view. Worth
 * revisiting only if that turns out to matter in practice (e.g. an
 * "archive departing members as legacy players" admin action).
 */
export async function computeGroupPlayerStats(
  payload: Payload,
  groupId: string | number,
  seasonId?: string | number,
): Promise<PlayerStatsRow[]> {
  const [{ docs: memberships }, { docs: legacyPlayers }, { docs: fixtures }] = await Promise.all([
    payload.find({
      collection: 'memberships',
      where: { group: { equals: groupId } },
      pagination: false,
      depth: 1,
      overrideAccess: true,
    }),
    payload.find({
      collection: 'legacyPlayers',
      where: { group: { equals: groupId } },
      pagination: false,
      depth: 0,
      overrideAccess: true,
    }),
    payload.find({
      collection: 'fixtures',
      where: seasonId
        ? { group: { equals: groupId }, status: { equals: 'played' }, season: { equals: seasonId } }
        : { group: { equals: groupId }, status: { equals: 'played' } },
      pagination: false,
      depth: 0,
      overrideAccess: true,
    }),
  ]);

  const rowsByKey = new Map<string, PlayerStatsRow>();
  for (const m of memberships) {
    const user = typeof m.user === 'object' && m.user !== null ? m.user : null;
    if (!user) continue;
    const k = key(user.id, 'users');
    if (rowsByKey.has(k)) continue;
    rowsByKey.set(k, {
      playerId: String(user.id),
      playerKind: 'users',
      name: user.name,
      initials: user.initials ?? undefined,
      position: user.position ?? undefined,
      memberSince: user.memberSince ?? undefined,
      played: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      goals: 0,
      ownGoals: 0,
      mvps: 0,
      goalDiff: 0,
      matches: [],
    });
  }
  for (const lp of legacyPlayers) {
    const k = key(lp.id, 'legacyPlayers');
    if (rowsByKey.has(k)) continue;
    rowsByKey.set(k, {
      playerId: String(lp.id),
      playerKind: 'legacyPlayers',
      name: lp.name,
      initials: lp.initials ?? undefined,
      position: lp.position ?? undefined,
      memberSince: undefined,
      played: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      goals: 0,
      ownGoals: 0,
      mvps: 0,
      goalDiff: 0,
      matches: [],
    });
  }

  const fixtureIds = fixtures.map((f) => f.id);
  const fixtureDateById = new Map(fixtures.map((f) => [String(f.id), typeof f.date === 'string' ? f.date : String(f.date)]));

  if (fixtureIds.length > 0) {
    const [{ docs: lineups }, { docs: results }] = await Promise.all([
      payload.find({
        collection: 'lineups',
        where: { fixture: { in: fixtureIds } },
        pagination: false,
        depth: 0,
        overrideAccess: true,
      }),
      payload.find({
        collection: 'matchResults',
        where: { fixture: { in: fixtureIds } },
        pagination: false,
        depth: 0,
        overrideAccess: true,
      }),
    ]);
    const lineupByFixture = new Map(
      lineups.map((l) => [String(typeof l.fixture === 'object' && l.fixture !== null ? l.fixture.id : l.fixture), l]),
    );

    for (const result of results) {
      const fixtureId = typeof result.fixture === 'object' && result.fixture !== null ? result.fixture.id : result.fixture;
      const lineup = lineupByFixture.get(String(fixtureId));
      if (!lineup) continue;

      const redRefs = polyRefs(lineup.redPlayers);
      const greenRefs = polyRefs(lineup.greenPlayers);
      const redKeys = new Set(redRefs.map((r) => key(r.id, r.kind)));
      const redScore = typeof result.redScore === 'number' ? result.redScore : 0;
      const greenScore = typeof result.greenScore === 'number' ? result.greenScore : 0;
      const mvpId = polyId(result.mvp);
      const mvpKind = polyKind(result.mvp);

      const goalsByKey = new Map<string, number>();
      if (Array.isArray(result.goals)) {
        for (const g of result.goals as Array<Record<string, unknown>>) {
          const pid = polyId(g.player);
          const pkind = polyKind(g.player);
          if (pid === undefined || !pkind) continue;
          const k = key(pid, pkind);
          goalsByKey.set(k, (goalsByKey.get(k) ?? 0) + (typeof g.count === 'number' ? g.count : 0));
        }
      }

      const date = fixtureDateById.get(String(fixtureId)) ?? '';

      for (const ref of [...redRefs, ...greenRefs]) {
        const k = key(ref.id, ref.kind);
        const row = rowsByKey.get(k);
        if (!row) continue;
        const onRed = redKeys.has(k);
        const teamScore = onRed ? redScore : greenScore;
        const oppScore = onRed ? greenScore : redScore;
        const outcome: MatchOutcome = teamScore > oppScore ? 'win' : teamScore === oppScore ? 'draw' : 'loss';
        const goals = goalsByKey.get(k) ?? 0;
        const isMvp = mvpId !== undefined && mvpKind === ref.kind && String(mvpId) === String(ref.id);
        const diff = teamScore - oppScore;

        row.played += 1;
        if (outcome === 'win') row.wins += 1;
        else if (outcome === 'draw') row.draws += 1;
        else row.losses += 1;
        row.goals += goals;
        if (isMvp) row.mvps += 1;
        row.goalDiff += diff;
        row.matches.push({ fixtureId, date, outcome, goals, mvp: isMvp, goalDiff: diff });
      }
    }
  }

  for (const row of rowsByKey.values()) {
    row.matches.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }

  // §3.7: all-time totals fold in each player's lump-sum baseline import
  // (path B) — season totals never do, there's no meaningful season for a
  // baseline row.
  if (seasonId === undefined) {
    const { docs: careerRows } = await payload.find({
      collection: 'playerCareerStats',
      where: { group: { equals: groupId } },
      pagination: false,
      depth: 0,
      overrideAccess: true,
    });
    for (const career of careerRows) {
      const id = polyId(career.player);
      const kind = polyKind(career.player);
      if (id === undefined || !kind) continue;
      const row = rowsByKey.get(key(id, kind));
      if (!row) continue;
      row.played += typeof career.baselinePlayed === 'number' ? career.baselinePlayed : 0;
      row.wins += typeof career.baselineWins === 'number' ? career.baselineWins : 0;
      row.draws += typeof career.baselineDraws === 'number' ? career.baselineDraws : 0;
      row.losses += typeof career.baselineLosses === 'number' ? career.baselineLosses : 0;
      row.goals += typeof career.baselineGoals === 'number' ? career.baselineGoals : 0;
      row.ownGoals += typeof career.baselineOwnGoals === 'number' ? career.baselineOwnGoals : 0;
      row.mvps += typeof career.baselineMvps === 'number' ? career.baselineMvps : 0;
      row.goalDiff += typeof career.baselineGoalDiff === 'number' ? career.baselineGoalDiff : 0;
    }
  }

  return [...rowsByKey.values()];
}

/** Win streak length, counting back from the most recent match — 0 unless the most recent result was itself a win (support.js's `streakKind === "S"` rule). */
export function currentWinStreak(matches: PlayerMatchRecord[]): number {
  let streak = 0;
  for (let i = matches.length - 1; i >= 0; i -= 1) {
    if (matches[i].outcome === 'win') streak += 1;
    else break;
  }
  return streak;
}

/** Last 5 results, most-recent-first — matches support.js's `form` array order (new result unshifted onto the front). */
export function last5Form(matches: PlayerMatchRecord[]): ('S' | 'U' | 'N')[] {
  return matches
    .slice(-5)
    .reverse()
    .map((m) => (m.outcome === 'win' ? 'S' : m.outcome === 'draw' ? 'U' : 'N'));
}

export type MetricKey = 'tore' | 'quote' | 'siege' | 'teilnahmen' | 'diff' | 'streak' | 'mvp' | 'eigen';
export const METRIC_KEYS: MetricKey[] = ['tore', 'quote', 'siege', 'teilnahmen', 'diff', 'streak', 'mvp', 'eigen'];

function metricValue(row: PlayerStatsRow, metric: MetricKey): number {
  switch (metric) {
    case 'tore':
      return row.goals;
    case 'quote':
      return Math.round((row.wins / Math.max(1, row.played)) * 100);
    case 'siege':
      return row.wins;
    case 'teilnahmen':
      return row.played;
    case 'diff':
      return row.goalDiff;
    case 'streak':
      return currentWinStreak(row.matches);
    case 'mvp':
      return row.mvps;
    case 'eigen':
      return row.ownGoals;
    default:
      return 0;
  }
}

function metricValueLabel(metric: MetricKey, value: number): string {
  if (metric === 'quote') return `${value}%`;
  if (metric === 'diff') return value > 0 ? `+${value}` : String(value);
  // support.js: streak shows "N×S" for a live win streak, "–" otherwise (a
  // streak of 0 never gets an "×S" suffix — that would misleadingly read
  // as a one-loss "streak").
  if (metric === 'streak') return value > 0 ? `${value}×S` : '–';
  return String(value);
}

function metricSub(row: PlayerStatsRow, metric: MetricKey, scope: 'season' | 'alltime'): string {
  const memberSinceYear = row.memberSince ? new Date(row.memberSince).getUTCFullYear() : undefined;
  switch (metric) {
    case 'tore':
      return `${row.played} Spiele`;
    case 'quote':
      return `${row.wins} Siege`;
    case 'siege':
      return scope === 'season' ? `${row.wins}S · ${row.draws}U · ${row.losses}N` : `${row.played} Spiele`;
    case 'teilnahmen':
      return scope === 'season'
        ? // §6: 18 is the assumed season length, straight from support.js's
          // own `Math.round((p.s.sp / 18) * 100)` — not derived from the
          // group's actual fixture count. A group with a very different
          // season length will get a skewed percentage here; revisit if
          // that turns out to matter in practice.
          `${Math.round((row.played / 18) * 100)}% der Termine`
        : row.playerKind === 'legacyPlayers'
          ? 'ehemaliges Mitglied'
          : memberSinceYear
            ? `seit ${memberSinceYear}`
            : '';
    case 'diff':
      return 'als Teamspieler';
    case 'streak':
      return last5Form(row.matches).join(' ') || '–';
    case 'mvp':
      return 'Auszeichnungen';
    case 'eigen':
      return 'Hall of Shame';
    default:
      return '';
  }
}

export type RankedRow = {
  rank: number;
  playerId: string;
  playerKind: PolyKind;
  name: string;
  initials?: string;
  position?: string;
  value: number;
  valueLabel: string;
  sub: string;
  pct: number;
};

export type PodiumEntry = {
  rank: 1 | 2 | 3;
  playerId: string;
  playerKind: PolyKind;
  name: string;
  firstName: string;
  initials?: string;
  valueLabel: string;
};

/**
 * Ranks `rows` by one metric — implementation-plan.md §6. Stable sort, no
 * tiebreaker (matches support.js's plain `.sort((a,b) => b.raw - a.raw)`,
 * which relies on JS's spec-guaranteed stable sort for ties). `pct`'s
 * denominator is `Math.max(1, topValue)`, straight from support.js —
 * note this means a leaderboard where the top value is negative (only
 * possible for `diff`) produces an intentionally-faithful but visually odd
 * `pct`, same as the prototype.
 */
export function rankPlayersByMetric(
  rows: PlayerStatsRow[],
  metric: MetricKey,
  scope: 'season' | 'alltime',
): { rows: RankedRow[]; podium: PodiumEntry[] } {
  const withValues = rows.map((row) => ({ row, value: metricValue(row, metric) }));
  withValues.sort((a, b) => b.value - a.value);
  const maxValue = Math.max(1, withValues[0]?.value ?? 0);

  const ranked: RankedRow[] = withValues.map(({ row, value }, index) => ({
    rank: index + 1,
    playerId: row.playerId,
    playerKind: row.playerKind,
    name: row.name,
    initials: row.initials,
    position: row.position,
    value,
    valueLabel: metricValueLabel(metric, value),
    sub: metricSub(row, metric, scope),
    pct: Math.round((value / maxValue) * 100),
  }));

  // §6: podium order is [2nd, 1st, 3rd] with gold/silver/bronze rings and
  // 92/70/56px bars — the app derives ring color/height from `rank` alone,
  // so this only needs to hand back the three rows in that display order.
  const [first, second, third] = ranked;
  const podium: PodiumEntry[] = [second, first, third]
    .filter((r): r is RankedRow => Boolean(r))
    .map((r) => ({
      rank: r.rank as 1 | 2 | 3,
      playerId: r.playerId,
      playerKind: r.playerKind,
      name: r.name,
      firstName: r.name.split(' ')[0] ?? r.name,
      initials: r.initials,
      valueLabel: r.valueLabel,
    }));

  return { rows: ranked, podium };
}

export type MatchExtreme = {
  fixtureId: string;
  date: string;
  redScore: number;
  greenScore: number;
};

/** §B: season-scoped match records — biggest win margin, closest non-draw game, highest-scoring match. Any of the three is `null` when the scope has no played matches. */
export type SeasonRecords = {
  biggestWin: MatchExtreme | null;
  closestGame: MatchExtreme | null;
  highestScoring: MatchExtreme | null;
};

const EMPTY_SEASON_RECORDS: SeasonRecords = { biggestWin: null, closestGame: null, highestScoring: null };

export type SeasonSummary = {
  /** Number of played fixtures (matches with a recorded result) in scope. */
  playedCount: number;
  totalGoals: number;
  /** Rounded to one decimal. 0 when `playedCount` is 0. */
  avgGoalsPerMatch: number;
  /** Mean lineup size (red + green) across matches in scope, rounded to one decimal. 0 when no lineups are found. */
  avgAttendance: number;
  red: { wins: number; draws: number; losses: number };
  green: { wins: number; draws: number; losses: number };
  records: SeasonRecords;
};

const EMPTY_SEASON_SUMMARY: SeasonSummary = {
  playedCount: 0,
  totalGoals: 0,
  avgGoalsPerMatch: 0,
  avgAttendance: 0,
  red: { wins: 0, draws: 0, losses: 0 },
  green: { wins: 0, draws: 0, losses: 0 },
  records: EMPTY_SEASON_RECORDS,
};

/**
 * Group/season-level aggregate — companion to `computeGroupPlayerStats()`
 * above, which only ever ranks *players*. `claude/
 * feature-plan-stats-enhancements.md` §A: total Spieltage, total Tore, Ø
 * Tore/Spiel, Ø Teilnehmer/Termin, and the season's Rot-vs-Grün
 * wins/draws/losses record (a signal for whether strength-based
 * auto-balance is actually landing even over time). §B added `records`
 * (biggest win, closest game, highest-scoring match) in the same pass over
 * `results` below — no extra queries.
 *
 * `seasonId` omitted means all-time (every played fixture ever, no season
 * filter) — unlike the stats endpoint's `scope=season` fallback-to-active
 * behavior, this function never resolves an active season on its own; the
 * caller (the `/stats` endpoint) decides what "no seasonId" means for its
 * own scope.
 */
export async function computeSeasonSummary(
  payload: Payload,
  groupId: string | number,
  seasonId?: string | number,
): Promise<SeasonSummary> {
  const { docs: fixtures } = await payload.find({
    collection: 'fixtures',
    where: seasonId
      ? { group: { equals: groupId }, status: { equals: 'played' }, season: { equals: seasonId } }
      : { group: { equals: groupId }, status: { equals: 'played' } },
    pagination: false,
    depth: 0,
    overrideAccess: true,
  });

  if (fixtures.length === 0) return EMPTY_SEASON_SUMMARY;

  const fixtureIds = fixtures.map((f) => f.id);
  const fixtureDateById = new Map(fixtures.map((f) => [String(f.id), typeof f.date === 'string' ? f.date : String(f.date)]));
  const [{ docs: lineups }, { docs: results }] = await Promise.all([
    payload.find({
      collection: 'lineups',
      where: { fixture: { in: fixtureIds } },
      pagination: false,
      depth: 0,
      overrideAccess: true,
    }),
    payload.find({
      collection: 'matchResults',
      where: { fixture: { in: fixtureIds } },
      pagination: false,
      depth: 0,
      overrideAccess: true,
    }),
  ]);

  if (results.length === 0) return EMPTY_SEASON_SUMMARY;

  const lineupByFixture = new Map(
    lineups.map((l) => [String(typeof l.fixture === 'object' && l.fixture !== null ? l.fixture.id : l.fixture), l]),
  );

  let totalGoals = 0;
  let attendanceSum = 0;
  let attendanceCount = 0;
  const red = { wins: 0, draws: 0, losses: 0 };
  const green = { wins: 0, draws: 0, losses: 0 };
  let biggestWin: MatchExtreme | null = null;
  let biggestWinMargin = -1;
  let closestGame: MatchExtreme | null = null;
  let closestGameMargin = Infinity;
  let highestScoring: MatchExtreme | null = null;
  let highestScoringTotal = -1;

  for (const result of results) {
    const fixtureId = typeof result.fixture === 'object' && result.fixture !== null ? result.fixture.id : result.fixture;
    const redScore = typeof result.redScore === 'number' ? result.redScore : 0;
    const greenScore = typeof result.greenScore === 'number' ? result.greenScore : 0;
    totalGoals += redScore + greenScore;

    if (redScore > greenScore) {
      red.wins += 1;
      green.losses += 1;
    } else if (greenScore > redScore) {
      green.wins += 1;
      red.losses += 1;
    } else {
      red.draws += 1;
      green.draws += 1;
    }

    const margin = Math.abs(redScore - greenScore);
    const matchTotal = redScore + greenScore;
    const extreme: MatchExtreme = {
      fixtureId: String(fixtureId),
      date: fixtureDateById.get(String(fixtureId)) ?? '',
      redScore,
      greenScore,
    };
    if (margin > biggestWinMargin) {
      biggestWinMargin = margin;
      biggestWin = extreme;
    }
    // "Closest game" excludes draws (margin 0) — a draw isn't a close win,
    // it's not a win at all.
    if (margin > 0 && margin < closestGameMargin) {
      closestGameMargin = margin;
      closestGame = extreme;
    }
    if (matchTotal > highestScoringTotal) {
      highestScoringTotal = matchTotal;
      highestScoring = extreme;
    }

    const lineup = lineupByFixture.get(String(fixtureId));
    if (lineup) {
      attendanceSum += polyRefs(lineup.redPlayers).length + polyRefs(lineup.greenPlayers).length;
      attendanceCount += 1;
    }
  }

  const playedCount = results.length;
  return {
    playedCount,
    totalGoals,
    avgGoalsPerMatch: Math.round((totalGoals / playedCount) * 10) / 10,
    avgAttendance: attendanceCount > 0 ? Math.round((attendanceSum / attendanceCount) * 10) / 10 : 0,
    red,
    green,
    records: { biggestWin, closestGame, highestScoring },
  };
}

export type PlayerMatchHighlight = {
  playerId: string;
  playerKind: PolyKind;
  name: string;
  fixtureId: string;
  date: string;
  goals: number;
};

export type LongestStreakHighlight = {
  playerId: string;
  playerKind: PolyKind;
  name: string;
  streak: number;
};

/** §B: all-time-only "Hall of Fame" — deliberately unscoped by season. */
export type AllTimeRecords = {
  topSingleMatchGoals: PlayerMatchHighlight | null;
  longestWinStreak: LongestStreakHighlight | null;
};

/** Longest run of consecutive wins anywhere in `matches` (chronological), not just the trailing one — unlike `currentWinStreak()`, which only ever looks at the tail. */
export function longestWinStreakEver(matches: PlayerMatchRecord[]): number {
  let best = 0;
  let current = 0;
  for (const m of matches) {
    if (m.outcome === 'win') {
      current += 1;
      if (current > best) best = current;
    } else {
      current = 0;
    }
  }
  return best;
}

/**
 * Pure/sync — deliberately takes `allRows` rather than fetching anything
 * itself. The caller (the `/stats` endpoint, `scope=alltime`) already has
 * `computeGroupPlayerStats(payload, groupId)` (no `seasonId`) on hand for
 * the ranked-list response, and that result already carries every
 * player's full chronological match list — goals-per-match included —
 * which is everything both records below need. Folding this in avoids a
 * second all-time fetch entirely.
 */
export function computeAllTimeRecords(allRows: PlayerStatsRow[]): AllTimeRecords {
  let topSingleMatchGoals: PlayerMatchHighlight | null = null;
  let longestWinStreak: LongestStreakHighlight | null = null;

  for (const row of allRows) {
    for (const m of row.matches) {
      if (m.goals > 0 && (!topSingleMatchGoals || m.goals > topSingleMatchGoals.goals)) {
        topSingleMatchGoals = {
          playerId: row.playerId,
          playerKind: row.playerKind,
          name: row.name,
          fixtureId: String(m.fixtureId),
          date: m.date,
          goals: m.goals,
        };
      }
    }
    const streak = longestWinStreakEver(row.matches);
    if (streak > 0 && (!longestWinStreak || streak > longestWinStreak.streak)) {
      longestWinStreak = { playerId: row.playerId, playerKind: row.playerKind, name: row.name, streak };
    }
  }

  return { topSingleMatchGoals, longestWinStreak };
}

export type DuoPlayerRef = {
  playerId: string;
  playerKind: PolyKind;
  name: string;
  initials?: string;
};

export type DuoStanding = {
  playerA: DuoPlayerRef;
  playerB: DuoPlayerRef;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  /** Rounded percentage, 0-100. */
  winRate: number;
};

/**
 * Below this many shared matches, a pair's win rate is dropped from
 * `computeBestDuos()`'s results — otherwise a single shared win reads as a
 * "100%" duo, which is more fluke than fact (§C's own "min-games threshold
 * to avoid a 1-game 100% fluke dominating the list").
 */
const MIN_GAMES_TOGETHER = 3;
const BEST_DUOS_LIMIT = 3;

/**
 * §C ("Beste Duos") — the pairs of players who win most often when placed
 * on the same color together, per `claude/
 * feature-plan-stats-enhancements.md` §C. Resolves that section's open
 * question in favor of a group-wide leaderboard (shown on the
 * Saison-Übersicht screen) rather than a per-player "best teammate" line
 * on Spielerprofil — an O(players²) pass over each match's teammates,
 * which is fine at 5-a-side group scale (a few dozen members at most).
 *
 * Self-contained fetch (own roster + fixtures/lineups/matchResults) rather
 * than reusing `computeGroupPlayerStats()`'s output, since that function's
 * per-player match list doesn't carry *who else* was on the same team —
 * only the player's own outcome per match, which isn't enough to tally a
 * pair.
 */
export async function computeBestDuos(
  payload: Payload,
  groupId: string | number,
  seasonId?: string | number,
): Promise<DuoStanding[]> {
  const [{ docs: memberships }, { docs: legacyPlayers }, { docs: fixtures }] = await Promise.all([
    payload.find({
      collection: 'memberships',
      where: { group: { equals: groupId } },
      pagination: false,
      depth: 1,
      overrideAccess: true,
    }),
    payload.find({
      collection: 'legacyPlayers',
      where: { group: { equals: groupId } },
      pagination: false,
      depth: 0,
      overrideAccess: true,
    }),
    payload.find({
      collection: 'fixtures',
      where: seasonId
        ? { group: { equals: groupId }, status: { equals: 'played' }, season: { equals: seasonId } }
        : { group: { equals: groupId }, status: { equals: 'played' } },
      pagination: false,
      depth: 0,
      overrideAccess: true,
    }),
  ]);

  if (fixtures.length === 0) return [];

  const refByKey = new Map<string, DuoPlayerRef>();
  for (const m of memberships) {
    const user = typeof m.user === 'object' && m.user !== null ? m.user : null;
    if (!user) continue;
    const k = key(user.id, 'users');
    if (!refByKey.has(k)) {
      refByKey.set(k, { playerId: String(user.id), playerKind: 'users', name: user.name, initials: user.initials ?? undefined });
    }
  }
  for (const lp of legacyPlayers) {
    const k = key(lp.id, 'legacyPlayers');
    if (!refByKey.has(k)) {
      refByKey.set(k, { playerId: String(lp.id), playerKind: 'legacyPlayers', name: lp.name, initials: lp.initials ?? undefined });
    }
  }

  const fixtureIds = fixtures.map((f) => f.id);
  const [{ docs: lineups }, { docs: results }] = await Promise.all([
    payload.find({
      collection: 'lineups',
      where: { fixture: { in: fixtureIds } },
      pagination: false,
      depth: 0,
      overrideAccess: true,
    }),
    payload.find({
      collection: 'matchResults',
      where: { fixture: { in: fixtureIds } },
      pagination: false,
      depth: 0,
      overrideAccess: true,
    }),
  ]);

  const lineupByFixture = new Map(
    lineups.map((l) => [String(typeof l.fixture === 'object' && l.fixture !== null ? l.fixture.id : l.fixture), l]),
  );

  const tallyByPairKey = new Map<string, { wins: number; draws: number; losses: number }>();
  const refsByPairKey = new Map<string, [string, string]>();

  function tallyTeamPairs(refs: { id: string | number; kind: PolyKind }[], outcome: MatchOutcome) {
    const keys = refs.map((r) => key(r.id, r.kind)).filter((k) => refByKey.has(k));
    for (let i = 0; i < keys.length; i += 1) {
      for (let j = i + 1; j < keys.length; j += 1) {
        const sorted = [keys[i], keys[j]].sort() as [string, string];
        const pairKey = sorted.join('|');
        let tally = tallyByPairKey.get(pairKey);
        if (!tally) {
          tally = { wins: 0, draws: 0, losses: 0 };
          tallyByPairKey.set(pairKey, tally);
          refsByPairKey.set(pairKey, sorted);
        }
        if (outcome === 'win') tally.wins += 1;
        else if (outcome === 'draw') tally.draws += 1;
        else tally.losses += 1;
      }
    }
  }

  for (const result of results) {
    const fixtureId = typeof result.fixture === 'object' && result.fixture !== null ? result.fixture.id : result.fixture;
    const lineup = lineupByFixture.get(String(fixtureId));
    if (!lineup) continue;

    const redScore = typeof result.redScore === 'number' ? result.redScore : 0;
    const greenScore = typeof result.greenScore === 'number' ? result.greenScore : 0;
    const redOutcome: MatchOutcome = redScore > greenScore ? 'win' : redScore === greenScore ? 'draw' : 'loss';
    const greenOutcome: MatchOutcome = greenScore > redScore ? 'win' : greenScore === redScore ? 'draw' : 'loss';

    tallyTeamPairs(polyRefs(lineup.redPlayers), redOutcome);
    tallyTeamPairs(polyRefs(lineup.greenPlayers), greenOutcome);
  }

  const standings: DuoStanding[] = [];
  for (const [pairKey, tally] of tallyByPairKey) {
    const played = tally.wins + tally.draws + tally.losses;
    if (played < MIN_GAMES_TOGETHER) continue;
    const [keyA, keyB] = refsByPairKey.get(pairKey)!;
    const playerA = refByKey.get(keyA);
    const playerB = refByKey.get(keyB);
    if (!playerA || !playerB) continue;
    standings.push({
      playerA,
      playerB,
      played,
      wins: tally.wins,
      draws: tally.draws,
      losses: tally.losses,
      winRate: Math.round((tally.wins / played) * 100),
    });
  }

  standings.sort((a, b) => b.winRate - a.winRate || b.played - a.played);
  return standings.slice(0, BEST_DUOS_LIMIT);
}
