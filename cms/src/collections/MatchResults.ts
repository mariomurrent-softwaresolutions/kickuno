import type { CollectionConfig } from 'payload';

/**
 * One row per played fixture — implementation-plan.md §3.1. Locked down
 * entirely at the collection level, same as `Rsvps.ts`/`Lineups.ts`: every
 * legitimate read/write goes through the curated `Fixtures.ts` endpoints
 * (`GET`/`POST /:id/result`), which also flip the fixture to "played" and
 * trigger the stats recompute (§3.2) as part of saving — plus the import
 * service (`cms/src/import/fixtures.ts`, phase 6), which writes directly
 * with `overrideAccess: true` and stamps `source: 'import'` +
 * `importBatch`.
 *
 * `mvp` and `goals[].player` are now the polymorphic `[users,
 * legacyPlayers]` relation (§3.1, phase 6) — read with `polyId`/`polyKind`
 * (`cms/src/lib/polymorphic.ts`), not a plain id/populated-doc check. Every
 * *live* result saved through `Fixtures.ts`'s endpoint only ever references
 * real `users` (the app only ever lets you pick from that fixture's actual
 * lineup); `legacyPlayers` references only ever come from an imported row.
 *
 * `goals[].isOwnGoal` (feature-plan-seasons-and-multigroup.md §C) lets a
 * `goals[]` entry represent an own goal attributed to a specific player,
 * alongside the older team-level `redOwnGoals`/`greenOwnGoals` counters
 * (kept for own goals with no known scorer — "Sonstiges Eigentor" in the
 * app). `redOwnGoals`/`greenOwnGoals` are the *total* per team either way;
 * see their field-level `admin.description` for exactly what's summed in.
 */
export const MatchResults: CollectionConfig = {
  slug: 'matchResults',
  admin: { useAsTitle: 'fixture' },
  access: {
    read: () => false,
    create: () => false,
    update: () => false,
    delete: () => false,
  },
  fields: [
    { name: 'fixture', type: 'relationship', relationTo: 'fixtures', required: true, unique: true },
    { name: 'redScore', type: 'number', required: true, defaultValue: 0 },
    { name: 'greenScore', type: 'number', required: true, defaultValue: 0 },
    {
      name: 'redOwnGoals',
      type: 'number',
      defaultValue: 0,
      admin: { description: "Total own goals committed by the red team (credited to green's score) — the sum of any attributed `goals[]` entries (`team: 'red', isOwnGoal: true`) plus an unattributed remainder for own goals with no known scorer (\"Sonstiges Eigentor\"). Recomputed server-side on every save (`Fixtures.ts`'s `/:id/result` POST handler), not trusted as-sent from the client." },
    },
    {
      name: 'greenOwnGoals',
      type: 'number',
      defaultValue: 0,
      admin: { description: "Mirror of `redOwnGoals` for the green team." },
    },
    { name: 'mvp', type: 'relationship', relationTo: ['users', 'legacyPlayers'] },
    {
      name: 'goals',
      type: 'array',
      fields: [
        { name: 'player', type: 'relationship', relationTo: ['users', 'legacyPlayers'], required: true },
        {
          name: 'team',
          type: 'select',
          required: true,
          options: [
            { label: 'Rot', value: 'red' },
            { label: 'Grün', value: 'green' },
          ],
          admin: { description: "This player's own team — for an own goal (`isOwnGoal: true`), the score credit goes to the *other* side, not this one." },
        },
        { name: 'count', type: 'number', required: true, defaultValue: 1 },
        {
          name: 'isOwnGoal',
          type: 'checkbox',
          defaultValue: false,
          admin: { description: 'True when this entry is an own goal scored by `player` (against their own team). A player can have both a regular-goal entry and a separate own-goal entry in the same match. See feature-plan-seasons-and-multigroup.md §C.' },
        },
      ],
    },
    { name: 'recordedBy', type: 'relationship', relationTo: 'users', admin: { readOnly: true } },
    { name: 'recordedAt', type: 'date', admin: { readOnly: true } },
    {
      name: 'source',
      type: 'select',
      defaultValue: 'live',
      options: [
        { label: 'Live erfasst', value: 'live' },
        { label: 'Import', value: 'import' },
      ],
      admin: { readOnly: true },
    },
    {
      name: 'importBatch',
      type: 'relationship',
      relationTo: 'importBatches',
      admin: { readOnly: true, description: 'Set only when `source` is `import` — identifies which import run created this row, for rollback (§3.7).' },
    },
  ],
};
