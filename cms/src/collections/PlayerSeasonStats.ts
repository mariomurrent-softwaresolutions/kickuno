import type { CollectionConfig } from 'payload';

/**
 * Aggregation cache, rebuilt from scratch by `recomputeStatsForPlayers`
 * (`cms/src/lib/stats.ts`) whenever a `matchResults` row changes —
 * implementation-plan.md §3.1/§3.2. Never hand-edited, so it's locked down
 * entirely; the phase-5 `GET /stats` endpoint reads it with
 * `overrideAccess: true`, same pattern as every other cross-cutting read in
 * this backend.
 *
 * `player` is now the polymorphic `[users, legacyPlayers]` relation (§3.1,
 * phase 6) — a legacy player can accumulate season stats too, from an
 * imported match-by-match fixture (§3.7 path A). Querying this collection
 * by player is deliberately avoided everywhere (`stats.ts`) in favor of a
 * season/group-scoped fetch + in-memory lookup, since Payload's Mongo
 * adapter only special-cases `equals`/`{relationTo,value}` for polymorphic
 * relationship queries, not a plain-id `in` — see the comment in
 * `stats.ts` for the full reasoning. The old `unique: ['player','season']`
 * compound index is dropped for the same reason — a Mongo unique index over
 * an embedded `{relationTo,value}` object is fragile (key-order-sensitive)
 * rather than a clean scalar comparison; `stats.ts`'s upsert-by-lookup
 * (find-then-update-or-create) already prevents duplicates without it.
 */
export const PlayerSeasonStats: CollectionConfig = {
  slug: 'playerSeasonStats',
  admin: { useAsTitle: 'id' },
  access: {
    read: () => false,
    create: () => false,
    update: () => false,
    delete: () => false,
  },
  fields: [
    { name: 'player', type: 'relationship', relationTo: ['users', 'legacyPlayers'], required: true },
    { name: 'season', type: 'relationship', relationTo: 'seasons', required: true },
    { name: 'played', type: 'number', defaultValue: 0 },
    { name: 'wins', type: 'number', defaultValue: 0 },
    { name: 'draws', type: 'number', defaultValue: 0 },
    { name: 'losses', type: 'number', defaultValue: 0 },
    { name: 'goals', type: 'number', defaultValue: 0 },
    {
      name: 'ownGoals',
      type: 'number',
      defaultValue: 0,
      admin: { description: 'Always 0 for now — matchResults records own goals at the team level only, not per player. See stats.ts.' },
    },
    { name: 'mvps', type: 'number', defaultValue: 0 },
    { name: 'goalDiff', type: 'number', defaultValue: 0 },
  ],
};
