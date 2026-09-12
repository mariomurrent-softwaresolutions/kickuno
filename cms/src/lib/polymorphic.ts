/**
 * Helpers for Payload's polymorphic-relationship data shape — used by
 * every collection whose `player` field is `relationTo: ['users',
 * 'legacyPlayers']` (Lineups.redPlayers/greenPlayers, MatchResults.mvp/
 * goals[].player, PlayerSeasonStats.player, PlayerCareerStats.player —
 * implementation-plan.md §3.1/§3.7, phase 6).
 *
 * A polymorphic relationship value is `{ relationTo: '<slug>', value: id }`
 * when unpopulated, or `{ relationTo: '<slug>', value: <populated doc> }`
 * at depth > 0 — confirmed by reading Payload's own
 * `dist/fields/hooks/beforeValidate/promise.js` (the same shape a
 * `hasMany` polymorphic field uses per array entry). This is a different
 * shape from the plain-id-or-populated-doc value a monomorphic
 * relationship uses (see the plain `toIds()` helpers still used for
 * `fixtures.hall`, `memberships.user`, etc. — those fields are NOT
 * polymorphic and don't need these helpers).
 */

export type PolyKind = 'users' | 'legacyPlayers';

export type PolyRelation = { relationTo: PolyKind; value: string | number | Record<string, unknown> };

function isPolyRelation(v: unknown): v is PolyRelation {
  return typeof v === 'object' && v !== null && 'relationTo' in v && 'value' in v;
}

/** Raw id from one polymorphic relationship value, populated or not. Returns undefined for null/undefined input. */
export function polyId(rel: unknown): string | number | undefined {
  if (rel === null || rel === undefined) return undefined;
  if (!isPolyRelation(rel)) return undefined;
  const { value } = rel;
  if (typeof value === 'object' && value !== null && 'id' in value) {
    return (value as { id: string | number }).id;
  }
  return value as string | number;
}

/** Which collection ('users' | 'legacyPlayers') one polymorphic relationship value points at. */
export function polyKind(rel: unknown): PolyKind | undefined {
  return isPolyRelation(rel) ? rel.relationTo : undefined;
}

/** Array of raw ids from a hasMany polymorphic field's value, skipping anything unresolvable. */
export function polyIds(list: unknown): (string | number)[] {
  if (!Array.isArray(list)) return [];
  return list.map((item) => polyId(item)).filter((id): id is string | number => id !== undefined);
}

/** Array of {id, kind} pairs from a hasMany polymorphic field's value — for when the caller needs to know which collection each id belongs to (e.g. building a mixed users+legacyPlayers roster). */
export function polyRefs(list: unknown): { id: string | number; kind: PolyKind }[] {
  if (!Array.isArray(list)) return [];
  return list
    .map((item) => {
      const id = polyId(item);
      const kind = polyKind(item);
      return id !== undefined && kind ? { id, kind } : undefined;
    })
    .filter((x): x is { id: string | number; kind: PolyKind } => Boolean(x));
}

/** {id, kind} pair from one non-hasMany polymorphic field's value. */
export function polyRef1(rel: unknown): { id: string | number; kind: PolyKind } | undefined {
  const id = polyId(rel);
  const kind = polyKind(rel);
  return id !== undefined && kind ? { id, kind } : undefined;
}

/** Builds one write-shape polymorphic relation value — pass this (or an array of these, for a hasMany field) as the field's value on create/update. */
export function polyRef(kind: PolyKind, id: string | number): PolyRelation {
  return { relationTo: kind, value: id };
}

/**
 * The relationship's stored value with the polymorphic wrapper stripped
 * off — a raw id when unpopulated, or the full populated doc at depth > 0
 * — i.e. exactly the shape a plain (non-polymorphic) relationship field
 * already returns. Use this, not `polyId`, when a value has to go straight
 * back out to a client built against that older, monomorphic shape (e.g.
 * `Fixtures.ts`'s `/:id/result` endpoint normalizing `matchResults.mvp`/
 * `goals[].player` back to the plain `users` shape the app's Ergebnis
 * erfassen screen already expects — every *live* result only ever
 * references real users anyway, so nothing is lost by unwrapping).
 */
export function polyValue(rel: unknown): unknown {
  if (!isPolyRelation(rel)) return rel;
  return rel.value;
}
