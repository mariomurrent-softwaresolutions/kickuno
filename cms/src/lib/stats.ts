import type { Payload } from 'payload';

import { polyId, polyKind, polyRef, polyRefs, type PolyKind } from './polymorphic';

type Accumulator = {
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goals: number;
  ownGoals: number;
  mvps: number;
  goalDiff: number;
};

function emptyAccumulator(): Accumulator {
  return { played: 0, wins: 0, draws: 0, losses: 0, goals: 0, ownGoals: 0, mvps: 0, goalDiff: 0 };
}

export type PlayerRef = { id: string | number; kind: PolyKind };

/**
 * Recomputes `playerSeasonStats` (for `seasonId`, when given) and
 * `playerCareerStats.match*` (career-wide, always) for every player in
 * `players`, from scratch, by replaying every *played* fixture in
 * `groupId` that has a recorded `matchResults` row — implementation-plan.md
 * §3.2's "recompute, not increment" design, so fixing a past score can never
 * leave the cache inconsistent. Three queries total (fixtures, lineups,
 * matchResults for the whole group), then everything else is in-memory.
 *
 * `players` are `{id, kind}` pairs, not plain ids, since phase 6 made
 * `lineups.redPlayers`/`greenPlayers` polymorphic ([users, legacyPlayers],
 * §3.1/§3.7) — an imported match-by-match fixture (path A) can include
 * legacy "ghost" players, and this same recompute has to run for them too
 * so their season/career caches fall out with zero special-casing, exactly
 * like the plan calls for.
 *
 * Deliberately avoids querying `playerSeasonStats`/`playerCareerStats` by
 * `player` directly (`where: { player: { equals/in: ... } }`): Payload's
 * Mongo adapter only special-cases the `equals` operator for a polymorphic
 * relationship (rewriting it to compare the embedded `{relationTo,value}`
 * object), not `in` — a plain-id `in` query against a polymorphic field
 * silently fails to match. Simpler and more consistent with the rest of
 * this file's style: fetch every existing row for the season/group once
 * (already a small, bounded set) and look each player up in an in-memory
 * map keyed by `"<kind>:<id>"`, the same "bounded fetch + in-memory
 * reduce" shape `stats-query.ts` already uses.
 *
 * Own goals are attributed per player where known: a `goals[]` entry with
 * `isOwnGoal: true` (feature-plan-seasons-and-multigroup.md §C) adds to
 * that player's `ownGoals`/`matchOwnGoals` here, same shape as a regular
 * goal entry. An own goal with no known scorer never appears in `goals[]`
 * at all — it only ever shows up in `matchResults.redOwnGoals`/
 * `greenOwnGoals` (the "Sonstiges Eigentor" fallback bucket) — so it
 * correctly affects the match score without being credited to any specific
 * player's stats.
 */
export async function recomputeStatsForPlayers(
  payload: Payload,
  opts: { groupId: string | number; seasonId?: string | number; players: PlayerRef[] },
): Promise<void> {
  const { groupId, seasonId, players } = opts;
  if (players.length === 0) return;
  const key = (id: string | number, kind: PolyKind) => `${kind}:${id}`;
  const wantedKeys = new Set(players.map((p) => key(p.id, p.kind)));

  const { docs: fixtures } = await payload.find({
    collection: 'fixtures',
    where: { group: { equals: groupId }, status: { equals: 'played' } },
    pagination: false,
    depth: 0,
    overrideAccess: true,
  });
  const fixtureIds = fixtures.map((f) => f.id);
  const seasonByFixture = new Map(
    fixtures.map((f) => [String(f.id), typeof f.season === 'object' && f.season !== null ? f.season.id : f.season]),
  );

  const seasonAcc = new Map<string, Accumulator>();
  const careerAcc = new Map<string, Accumulator>();
  for (const p of players) {
    const k = key(p.id, p.kind);
    seasonAcc.set(k, emptyAccumulator());
    careerAcc.set(k, emptyAccumulator());
  }

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
      lineups.map((l) => [
        String(typeof l.fixture === 'object' && l.fixture !== null ? l.fixture.id : l.fixture),
        l,
      ]),
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
      const ownGoalsByKey = new Map<string, number>();
      if (Array.isArray(result.goals)) {
        for (const g of result.goals as Array<Record<string, unknown>>) {
          const pid = polyId(g.player);
          const pkind = polyKind(g.player);
          if (pid === undefined || !pkind) continue;
          const k = key(pid, pkind);
          const count = typeof g.count === 'number' ? g.count : 0;
          if (g.isOwnGoal === true) {
            ownGoalsByKey.set(k, (ownGoalsByKey.get(k) ?? 0) + count);
          } else {
            goalsByKey.set(k, (goalsByKey.get(k) ?? 0) + count);
          }
        }
      }

      const fixtureSeasonId = seasonByFixture.get(String(fixtureId));
      const inSeason = seasonId !== undefined && String(fixtureSeasonId) === String(seasonId);

      for (const ref of [...redRefs, ...greenRefs]) {
        const k = key(ref.id, ref.kind);
        if (!wantedKeys.has(k)) continue;
        const onRed = redKeys.has(k);
        const teamScore = onRed ? redScore : greenScore;
        const oppScore = onRed ? greenScore : redScore;
        const outcome: 'win' | 'draw' | 'loss' = teamScore > oppScore ? 'win' : teamScore === oppScore ? 'draw' : 'loss';
        const isMvp = mvpId !== undefined && mvpKind === ref.kind && String(mvpId) === String(ref.id);

        const applyTo = (acc: Accumulator) => {
          acc.played += 1;
          if (outcome === 'win') acc.wins += 1;
          else if (outcome === 'draw') acc.draws += 1;
          else acc.losses += 1;
          acc.goals += goalsByKey.get(k) ?? 0;
          acc.ownGoals += ownGoalsByKey.get(k) ?? 0;
          if (isMvp) acc.mvps += 1;
          acc.goalDiff += teamScore - oppScore;
        };

        applyTo(careerAcc.get(k)!);
        if (inSeason) applyTo(seasonAcc.get(k)!);
      }
    }
  }

  if (seasonId !== undefined) {
    await upsertSeasonStats(payload, seasonId, players, seasonAcc);
  }
  await upsertCareerStats(payload, groupId, players, careerAcc);
}

/** Fetches every existing playerSeasonStats row for `seasonId` and indexes it by `"<kind>:<id>"`, avoiding a per-player point query against the polymorphic `player` field (see the file-level comment). */
async function existingSeasonRowsByKey(payload: Payload, seasonId: string | number) {
  const { docs } = await payload.find({
    collection: 'playerSeasonStats',
    where: { season: { equals: seasonId } },
    pagination: false,
    depth: 0,
    overrideAccess: true,
  });
  const byKey = new Map<string, (typeof docs)[number]>();
  for (const doc of docs) {
    const id = polyId(doc.player);
    const kind = polyKind(doc.player);
    if (id !== undefined && kind) byKey.set(`${kind}:${id}`, doc);
  }
  return byKey;
}

async function existingCareerRowsByKey(payload: Payload, groupId: string | number) {
  const { docs } = await payload.find({
    collection: 'playerCareerStats',
    where: { group: { equals: groupId } },
    pagination: false,
    depth: 0,
    overrideAccess: true,
  });
  const byKey = new Map<string, (typeof docs)[number]>();
  for (const doc of docs) {
    const id = polyId(doc.player);
    const kind = polyKind(doc.player);
    if (id !== undefined && kind) byKey.set(`${kind}:${id}`, doc);
  }
  return byKey;
}

async function upsertSeasonStats(
  payload: Payload,
  seasonId: string | number,
  players: PlayerRef[],
  seasonAcc: Map<string, Accumulator>,
) {
  const existingByKey = await existingSeasonRowsByKey(payload, seasonId);
  for (const p of players) {
    const k = `${p.kind}:${p.id}`;
    const acc = seasonAcc.get(k)!;
    const data = { player: polyRef(p.kind, p.id), season: seasonId, ...acc };
    const existing = existingByKey.get(k);
    if (existing) {
      // eslint-disable-next-line no-await-in-loop -- small bounded batch (one fixture's two lineups); sequential upserts keep this readable and it's never a hot path.
      await payload.update({ collection: 'playerSeasonStats', id: existing.id, data, overrideAccess: true });
    } else {
      // eslint-disable-next-line no-await-in-loop
      await payload.create({ collection: 'playerSeasonStats', data, overrideAccess: true });
    }
  }
}

async function upsertCareerStats(
  payload: Payload,
  groupId: string | number,
  players: PlayerRef[],
  careerAcc: Map<string, Accumulator>,
) {
  const existingByKey = await existingCareerRowsByKey(payload, groupId);
  for (const p of players) {
    const k = `${p.kind}:${p.id}`;
    const acc = careerAcc.get(k)!;
    const data = {
      player: polyRef(p.kind, p.id),
      group: groupId,
      matchPlayed: acc.played,
      matchWins: acc.wins,
      matchDraws: acc.draws,
      matchLosses: acc.losses,
      matchGoals: acc.goals,
      matchOwnGoals: acc.ownGoals,
      matchMvps: acc.mvps,
      matchGoalDiff: acc.goalDiff,
    };
    const existing = existingByKey.get(k);
    if (existing) {
      // eslint-disable-next-line no-await-in-loop
      await payload.update({ collection: 'playerCareerStats', id: existing.id, data, overrideAccess: true });
    } else {
      // eslint-disable-next-line no-await-in-loop
      await payload.create({ collection: 'playerCareerStats', data, overrideAccess: true });
    }
  }
}
