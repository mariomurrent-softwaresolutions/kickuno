import type { Payload } from 'payload';

/**
 * German football-season convention: "25/26" runs Aug–Jun. Used as a sane
 * default label when creating a season without one — admins can rename it
 * freely afterward (§3.1 `seasons.label`).
 */
export function currentSeasonLabel(now: Date = new Date()): string {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth(); // 0-indexed; 7 === August
  const startYear = month >= 7 ? year : year - 1;
  const endYear = (startYear + 1) % 100;
  return `${startYear}/${String(endYear).padStart(2, '0')}`;
}

/**
 * The group's active season, creating a sane default one if none has
 * `status: 'active'` yet — belt-and-suspenders for groups created before a
 * season existed, a group whose active season was completed without a
 * replacement being created yet (see `setActiveSeason` below), or if the
 * Groups.afterChange seed hook ever fails silently. Always uses
 * `overrideAccess` — this runs from inside other collections' hooks/
 * endpoints, not a client request.
 */
export async function getOrCreateCurrentSeason(
  payload: Payload,
  groupId: string | number,
): Promise<{ id: string | number }> {
  const existing = await payload.find({
    collection: 'seasons',
    where: { group: { equals: groupId }, status: { equals: 'active' } },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  });
  if (existing.docs[0]) return existing.docs[0];

  return payload.create({
    collection: 'seasons',
    data: {
      group: groupId,
      label: currentSeasonLabel(),
      status: 'active',
    },
    overrideAccess: true,
  });
}

/**
 * The group's active season, or `null` if none is currently active —
 * unlike `getOrCreateCurrentSeason` below, this NEVER creates one. Use this
 * wherever "the current season" is only being *consulted* (e.g. to base an
 * advisory computation on) rather than something that structurally needs a
 * season to exist, such as creating a fixture. A caller here should treat
 * `null` as "skip — nothing meaningful to compute without an active
 * season," not as a cue to create one itself.
 */
export async function getActiveSeason(
  payload: Payload,
  groupId: string | number,
): Promise<{ id: string | number } | null> {
  const existing = await payload.find({
    collection: 'seasons',
    where: { group: { equals: groupId }, status: { equals: 'active' } },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  });
  return existing.docs[0] ?? null;
}

/**
 * Makes `seasonId` the group's one active season, completing whichever
 * season (if any, and if different) currently holds that status — this is
 * the single place the "only one active season per group" invariant is
 * enforced, used by both `POST /groups/:id/seasons` (create-and-activate,
 * Groups.ts) and `POST /seasons/:id/activate` (Seasons.ts, reopening a
 * completed one).
 */
export async function setActiveSeason(
  payload: Payload,
  groupId: string | number,
  seasonId: string | number,
): Promise<void> {
  const currentlyActive = await payload.find({
    collection: 'seasons',
    where: { group: { equals: groupId }, status: { equals: 'active' } },
    pagination: false,
    depth: 0,
    overrideAccess: true,
  });
  await Promise.all(
    currentlyActive.docs
      .filter((doc) => String(doc.id) !== String(seasonId))
      .map((doc) =>
        payload.update({ collection: 'seasons', id: doc.id, data: { status: 'completed' }, overrideAccess: true }),
      ),
  );
  await payload.update({ collection: 'seasons', id: seasonId, data: { status: 'active' }, overrideAccess: true });
}
