import type { Payload } from 'payload';

import { polyId, polyKind } from './polymorphic';

export type PlayerSummary = {
  id: string | number;
  name: string;
  initials?: string;
  position?: string;
  strength?: number;
};

/**
 * User ids eligible for one fixture's pool — implementation-plan.md §3.8:
 * "confirmed" (rsvp === yes) when the group's `rsvp` feature is on, else
 * every member of the group.
 */
export async function eligiblePlayerIds(
  payload: Payload,
  groupId: string | number,
  fixtureId: string | number,
  rsvpEnabled: boolean,
): Promise<(string | number)[]> {
  if (rsvpEnabled) {
    const { docs } = await payload.find({
      collection: 'rsvps',
      where: { fixture: { equals: fixtureId }, status: { equals: 'yes' } },
      pagination: false,
      depth: 0,
      overrideAccess: true,
    });
    return docs.map((r) =>
      typeof r.user === 'object' && r.user !== null ? (r.user as { id: string | number }).id : (r.user as string | number),
    );
  }

  const { docs } = await payload.find({
    collection: 'memberships',
    where: { group: { equals: groupId } },
    pagination: false,
    depth: 0,
    overrideAccess: true,
  });
  return docs.map((m) =>
    typeof m.user === 'object' && m.user !== null ? (m.user as { id: string | number }).id : (m.user as string | number),
  );
}

/**
 * Strength per user id, from that group's memberships (§3.1) — used both to
 * render pool/team chips and as auto-balance's primary sort key. Missing
 * rows fall back to the schema default (3) rather than being excluded.
 */
export async function membershipStrengthByUser(
  payload: Payload,
  groupId: string | number,
  userIds: (string | number)[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (userIds.length === 0) return map;

  const { docs } = await payload.find({
    collection: 'memberships',
    where: { group: { equals: groupId }, user: { in: userIds } },
    pagination: false,
    depth: 0,
    overrideAccess: true,
  });
  for (const m of docs) {
    const uid = typeof m.user === 'object' && m.user !== null ? (m.user as { id: string | number }).id : (m.user as string | number);
    map.set(String(uid), typeof m.strength === 'number' ? m.strength : 3);
  }
  return map;
}

/**
 * Current-season goals per user id, from `playerSeasonStats` (§3.2/§5) — the
 * auto-balance tie-break, and its sole sort key when `features.strength` is
 * off. Missing rows (brand-new players, or before the stats hook has run
 * once) count as 0 rather than being excluded.
 *
 * `playerSeasonStats.player` is now the polymorphic `[users, legacyPlayers]`
 * relation (§3.1, phase 6), so this fetches every row for the season
 * (bounded by the group's roster size) and filters/keys in memory by
 * `polyId`, rather than `where: { player: { in: userIds } }` — Payload's
 * Mongo adapter doesn't match a plain-id `in` against a polymorphic
 * relationship field (see the longer note in `stats.ts`). Every id this
 * function is ever called with is a live-pool `users` id anyway (a legacy
 * player is never part of auto-balance), so only `kind === 'users'` rows
 * are considered.
 */
export async function seasonGoalsByUser(
  payload: Payload,
  seasonId: string | number | undefined,
  userIds: (string | number)[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (!seasonId || userIds.length === 0) return map;

  const wanted = new Set(userIds.map(String));
  const { docs } = await payload.find({
    collection: 'playerSeasonStats',
    where: { season: { equals: seasonId } },
    pagination: false,
    depth: 0,
    overrideAccess: true,
  });
  for (const row of docs) {
    if (polyKind(row.player) !== 'users') continue;
    const pid = polyId(row.player);
    if (pid === undefined || !wanted.has(String(pid))) continue;
    map.set(String(pid), typeof row.goals === 'number' ? row.goals : 0);
  }
  return map;
}

/**
 * Builds the `{id, name, initials, position, strength?}` shape used in the
 * pool/red/green arrays returned by the lineup endpoints (§3.6). `strengthById
 * === null` omits the field entirely — the server-side half of §3.8's
 * "no Stärke label anywhere when the flag is off". `userIds` here are
 * always real `users` ids — a live lineup's pool is drawn from RSVPs/
 * memberships, never `legacyPlayers` (§3.7).
 */
export async function playerSummaries(
  payload: Payload,
  userIds: (string | number)[],
  strengthById: Map<string, number> | null,
): Promise<PlayerSummary[]> {
  if (userIds.length === 0) return [];

  const { docs } = await payload.find({
    collection: 'users',
    where: { id: { in: userIds } },
    pagination: false,
    depth: 0,
    overrideAccess: true,
  });
  const byId = new Map(docs.map((u) => [String(u.id), u]));

  return userIds
    .map((id) => byId.get(String(id)))
    .filter((u): u is NonNullable<typeof u> => Boolean(u))
    .map((u) => ({
      id: u.id,
      name: u.name,
      initials: u.initials ?? undefined,
      position: u.position ?? undefined,
      ...(strengthById ? { strength: strengthById.get(String(u.id)) ?? 3 } : {}),
    }));
}
