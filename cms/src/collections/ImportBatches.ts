import type { CollectionConfig } from 'payload';

import { membershipGroupIds } from '../access/helpers';

/**
 * Audit trail for every historic-data import run — implementation-plan.md
 * §3.1/§3.7, phase 6. Always written by `cms/src/import/` with
 * `overrideAccess: true` (the CLI script runs as a trusted server process,
 * not through a client request); the collection API stays admin-only so
 * an admin can inspect what was imported and when.
 */
export const ImportBatches: CollectionConfig = {
  slug: 'importBatches',
  admin: { useAsTitle: 'fileName' },
  access: {
    read: async ({ req }) => {
      if (!req.user) return false;
      const ids = await membershipGroupIds(req, { roles: ['admin'] });
      if (ids.length === 0) return false;
      return { group: { in: ids } };
    },
    create: () => false,
    update: () => false,
    delete: () => false,
  },
  fields: [
    { name: 'group', type: 'relationship', relationTo: 'groups', required: true },
    {
      name: 'kind',
      type: 'select',
      required: true,
      options: [
        { label: 'Termine (Match-für-Match)', value: 'fixtures' },
        { label: 'Karriere-Basiswerte', value: 'career-baseline' },
        { label: 'Ehemalige Spieler', value: 'legacy-players' },
      ],
    },
    { name: 'fileName', type: 'text', required: true },
    { name: 'uploadedBy', type: 'relationship', relationTo: 'users' },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'draft',
      options: [
        { label: 'Entwurf (Vorschau)', value: 'draft' },
        { label: 'Übernommen', value: 'committed' },
        { label: 'Zurückgerollt', value: 'rolled-back' },
      ],
    },
    { name: 'rowCount', type: 'number', defaultValue: 0 },
    {
      name: 'errorLog',
      type: 'json',
      admin: { description: 'Unresolved names, skipped duplicates, and any row-level parse errors from the run that produced this batch.' },
    },
    {
      name: 'changeLog',
      type: 'json',
      admin: {
        readOnly: true,
        description:
          'Exactly what this batch created/modified (a `ChangeLog` from cms/src/import/types.ts) — read by rollbackImportBatch() to undo precisely this run without touching anything else (§3.7).',
      },
    },
  ],
  timestamps: true,
};
