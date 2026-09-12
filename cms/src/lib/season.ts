import type { Payload } from 'payload';

/**
 * German football-season convention: "25/26" runs Aug–Jun. Used only as a
 * sane default label for the season auto-created alongside a new group —
 * admins can rename it freely afterward (§3.1 `seasons.label`).
 */
export function currentSeasonLabel(now: Date = new Date()): string {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth(); // 0-indexed; 7 === August
  const startYear = month >= 7 ? year : year - 1;
  const endYear = (startYear + 1) % 100;
  return `${startYear}/${String(endYear).padStart(2, '0')}`;
}

/**
 * The group's current season, creating a sane default one if none is
 * marked `isCurrent` yet — belt-and-suspenders for groups created before a
 * season existed, or if the Groups.afterChange seed hook ever fails
 * silently. Always uses `overrideAccess` — this runs from inside other
 * collections' hooks/endpoints, not a client request.
 */
export async function getOrCreateCurrentSeason(
  payload: Payload,
  groupId: string | number,
): Promise<{ id: string | number }> {
  const existing = await payload.find({
    collection: 'seasons',
    where: { group: { equals: groupId }, isCurrent: { equals: true } },
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
      isCurrent: true,
    },
    overrideAccess: true,
  });
}
