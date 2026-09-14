import type { Payload } from 'payload';

import { getActiveSeason } from './season';
import { computeGroupPlayerStats, last5Form, type PlayerStatsRow } from './stats-query';

/**
 * `memberships.suggestedStrength` — implementation-plan.md §3.3: a
 * read-only, data-derived nudge the admin can glance at and apply with one
 * tap; it never overwrites `strength` on its own, and auto-balance never
 * reads it directly. Recomputed for the whole group's roster every time a
 * result is saved — called from `Fixtures.ts`'s `/:id/result` handler right
 * alongside `recomputeStatsForPlayers`, since this codebase has no
 * `matchResults.afterChange` collection hook; that endpoint *is* the
 * equivalent of "the matchResults hook" the plan describes.
 *
 * Only real `users` memberships are ever scored — `legacyPlayers` never has
 * a `memberships` row (§3.7), so those rows are simply absent from
 * `computeGroupPlayerStats`'s `playerKind === 'users'` subset here.
 *
 * Uses `getActiveSeason` (never `getOrCreateCurrentSeason`) on purpose: this
 * runs on every result save, completely independent of which season the
 * fixture itself belongs to, so it must never have the power to spawn a new
 * season as a side effect of an otherwise advisory computation — a real bug
 * found live (season-management feature plan follow-up, 2026-09-14): an
 * admin who completed the active season and then entered a result for an
 * old backlog fixture before starting the next season saw a surprise
 * placeholder season silently appear and get marked active. If there's no
 * active season right now, there's nothing sensible to compute "current
 * form" against anyway — skip the recompute entirely and leave whatever
 * `suggestedStrength`/`strengthSampleSize` values are already there.
 */
export async function recomputeSuggestedStrength(payload: Payload, groupId: string | number): Promise<void> {
  const season = await getActiveSeason(payload, groupId);
  if (!season) return;
  const rows = await computeGroupPlayerStats(payload, groupId, season.id);
  const rowByUserId = new Map(rows.filter((r) => r.playerKind === 'users').map((r) => [r.playerId, r]));

  const { docs: memberships } = await payload.find({
    collection: 'memberships',
    where: { group: { equals: groupId } },
    pagination: false,
    depth: 0,
    overrideAccess: true,
  });

  // §3.3: "a membership needs played >= 5 in the current season before it
  // gets a suggestion at all."
  const MIN_PLAYED = 5;
  type Candidate = {
    membershipId: string | number;
    winRate: number;
    goalDiffPerGame: number;
    goalsPerGame: number;
    recentForm: number;
  };
  const candidates: Candidate[] = [];
  const playedByMembershipKey = new Map<string, number>();

  for (const m of memberships) {
    const userId = typeof m.user === 'object' && m.user !== null ? (m.user as { id: string | number }).id : (m.user as string | number);
    const row = rowByUserId.get(String(userId));
    const played = row?.played ?? 0;
    playedByMembershipKey.set(String(m.id), played);
    if (!row || played < MIN_PLAYED) continue;

    candidates.push({
      membershipId: m.id,
      winRate: row.wins / played,
      goalDiffPerGame: row.goalDiff / played,
      goalsPerGame: row.goals / played,
      recentForm: recentFormScore(row),
    });
  }

  // Each input z-scored against the *group's* eligible pool (§3.3) — not
  // every member, only those who cleared MIN_PLAYED above.
  const winRateZ = zscores(candidates.map((c) => c.winRate));
  const goalDiffZ = zscores(candidates.map((c) => c.goalDiffPerGame));
  const goalsZ = zscores(candidates.map((c) => c.goalsPerGame));
  const formZ = zscores(candidates.map((c) => c.recentForm));

  const suggestedByMembershipKey = new Map<string, number>();
  candidates.forEach((c, i) => {
    const composite = 0.45 * winRateZ[i] + 0.3 * goalDiffZ[i] + 0.15 * goalsZ[i] + 0.1 * formZ[i];
    const suggested = composite <= -1.25 ? 1 : composite <= -0.4 ? 2 : composite < 0.4 ? 3 : composite < 1.25 ? 4 : 5;
    suggestedByMembershipKey.set(String(c.membershipId), suggested);
  });

  const now = new Date().toISOString();
  for (const m of memberships) {
    const suggested = suggestedByMembershipKey.get(String(m.id)) ?? null;
    const sampleSize = playedByMembershipKey.get(String(m.id)) ?? 0;
    // eslint-disable-next-line no-await-in-loop -- bounded by one group's roster; runs once per recorded result, not a hot path.
    await payload.update({
      collection: 'memberships',
      id: m.id,
      data: { suggestedStrength: suggested, strengthSampleSize: sampleSize, strengthSuggestedAt: now },
      overrideAccess: true,
    });
  }
}

/** last-5 results (most-recent-first), weighted [5,4,3,2,1], S=1/U=0.5/N=0, normalized to 0–1 (§3.3). */
function recentFormScore(row: PlayerStatsRow): number {
  const last5 = last5Form(row.matches);
  const weights = [5, 4, 3, 2, 1];
  let weighted = 0;
  let totalWeight = 0;
  last5.forEach((result, i) => {
    const w = weights[i] ?? 0;
    const score = result === 'S' ? 1 : result === 'U' ? 0.5 : 0;
    weighted += w * score;
    totalWeight += w;
  });
  return totalWeight > 0 ? weighted / totalWeight : 0;
}

function mean(xs: number[]): number {
  return xs.length > 0 ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function zscores(xs: number[]): number[] {
  const m = mean(xs);
  const variance = xs.length > 0 ? xs.reduce((a, x) => a + (x - m) ** 2, 0) / xs.length : 0;
  const sd = Math.sqrt(variance);
  // A pool of 1 (or every value identical) has zero spread — every z-score
  // is 0, which lands squarely on suggestedStrength 3 (the composite
  // thresholds' middle band), a reasonable "not enough spread to say
  // anything" default rather than a division-by-zero NaN.
  if (sd === 0) return xs.map(() => 0);
  return xs.map((x) => (x - m) / sd);
}
