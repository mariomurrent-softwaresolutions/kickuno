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

  return allGroupMemberIds(payload, groupId);
}

/** Every real member's user id for one group — every eligibility question ultimately bottoms out here. */
export async function allGroupMemberIds(payload: Payload, groupId: string | number): Promise<(string | number)[]> {
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

export type NotAttendingPlayer = PlayerSummary & { rsvpStatus: 'no' | 'none' };

/**
 * The four buckets a fixture's team-builder screen needs in one call
 * (§4.5): `pool` (eligible, unassigned), `red`/`green` (assigned — always
 * eligible themselves, by construction), and `notAttending` — every other
 * real group member, tagged with why they're not in the pool (`'no'` =
 * explicitly declined, `'none'` = never responded). Only ever non-empty
 * when `features.rsvp` is on: with it off, `eligiblePlayerIds()` already
 * returns every member, so nobody is left over to appear here.
 *
 * Not in the original plan — added so an admin/organizer can still pull in
 * someone who hasn't confirmed (or said no) when a fixture needs more
 * players, straight from this same screen (`PATCH .../lineup` marks them
 * attending as a side effect the moment they're assigned — see that
 * handler). Shared by the GET/PATCH lineup endpoints and auto-balance, so
 * all three keep returning the same shape.
 */
export async function buildLineupSummaries(
  payload: Payload,
  groupId: string | number,
  fixtureId: string | number,
  eligibleIds: (string | number)[],
  redIds: (string | number)[],
  greenIds: (string | number)[],
  strengthById: Map<string, number> | null,
): Promise<{ pool: PlayerSummary[]; red: PlayerSummary[]; green: PlayerSummary[]; notAttending: NotAttendingPlayer[] }> {
  const assigned = new Set([...redIds, ...greenIds].map(String));
  const poolIds = eligibleIds.filter((id) => !assigned.has(String(id)));

  const memberIds = await allGroupMemberIds(payload, groupId);
  const eligibleSet = new Set(eligibleIds.map(String));
  const notAttendingIds = memberIds.filter((id) => !eligibleSet.has(String(id)) && !assigned.has(String(id)));

  const notAttendingStatusById = new Map<string, 'no' | 'none'>();
  if (notAttendingIds.length > 0) {
    // Only explicit "no" rows come back here — anyone in `notAttendingIds`
    // with no row at all (never responded) simply won't appear, and is
    // labelled 'none' by the `?? 'none'` fallback below.
    const { docs } = await payload.find({
      collection: 'rsvps',
      where: { fixture: { equals: fixtureId }, user: { in: notAttendingIds } },
      pagination: false,
      depth: 0,
      overrideAccess: true,
    });
    for (const r of docs) {
      const uid = typeof r.user === 'object' && r.user !== null ? (r.user as { id: string | number }).id : (r.user as string | number);
      notAttendingStatusById.set(String(uid), r.status === 'no' ? 'no' : 'none');
    }
  }

  const [pool, red, green, notAttendingSummaries] = await Promise.all([
    playerSummaries(payload, poolIds, strengthById),
    playerSummaries(payload, redIds, strengthById),
    playerSummaries(payload, greenIds, strengthById),
    playerSummaries(payload, notAttendingIds, strengthById),
  ]);

  const notAttending: NotAttendingPlayer[] = notAttendingSummaries.map((p) => ({
    ...p,
    rsvpStatus: notAttendingStatusById.get(String(p.id)) ?? 'none',
  }));

  return { pool, red, green, notAttending };
}
