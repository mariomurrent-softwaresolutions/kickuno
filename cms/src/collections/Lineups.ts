import type { CollectionConfig } from 'payload';

/**
 * One row per fixture — implementation-plan.md §3.1. Locked down entirely at
 * the collection level: every legitimate read/write goes through the
 * curated `Fixtures.ts` endpoints (`/lineup`, `/auto-balance`), which need to
 * combine it with rsvps/memberships to compute the "pool" (confirmed vs.
 * everyone, §3.8) and enforce role checks — same locked-collection-plus-
 * endpoints pattern as `Rsvps.ts`.
 *
 * `redPlayers`/`greenPlayers` are now the polymorphic `[users,
 * legacyPlayers]` relation the plan describes (§3.1, phase 6) — but only
 * the import service (`cms/src/import/fixtures.ts`) ever writes a
 * `legacyPlayers` reference here; every *live* lineup written through
 * `Fixtures.ts`'s endpoints only ever contains real `users` (the RSVP/
 * membership pool a legacy player can never be part of). Read with
 * `polyIds`/`polyRefs` (`cms/src/lib/polymorphic.ts`), not the old plain-id
 * `toIds()` pattern.
 */
export const Lineups: CollectionConfig = {
  slug: 'lineups',
  admin: { useAsTitle: 'fixture' },
  access: {
    read: () => false,
    create: () => false,
    update: () => false,
    delete: () => false,
  },
  fields: [
    { name: 'fixture', type: 'relationship', relationTo: 'fixtures', required: true, unique: true },
    { name: 'redPlayers', type: 'relationship', relationTo: ['users', 'legacyPlayers'], hasMany: true },
    { name: 'greenPlayers', type: 'relationship', relationTo: ['users', 'legacyPlayers'], hasMany: true },
  ],
};
