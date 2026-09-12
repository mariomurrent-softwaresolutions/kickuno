import type { CollectionConfig } from 'payload';

/**
 * implementation-plan.md §3.1/§3.6. Deliberately narrow access: a regular
 * client only ever reads/writes their OWN rsvp row directly. The aggregate
 * "how many people said yes" and "confirmed pool" views other members need
 * are served by purpose-built endpoints on `Fixtures.ts`
 * (`/fixtures/:id/rsvp`, `/fixtures/:id/summary`) that read across
 * everyone's rows with `overrideAccess: true` — so nobody needs blanket
 * read access to their teammates' individual RSVPs for that to work.
 */
export const Rsvps: CollectionConfig = {
  slug: 'rsvps',
  admin: { useAsTitle: 'id' },
  access: {
    read: ({ req }) => {
      if (!req.user) return false;
      return { user: { equals: req.user.id } };
    },
    // Rows are only ever created/updated via `POST /fixtures/:id/rsvp`
    // (Fixtures.ts), which uses `overrideAccess: true` after checking group
    // membership and `features.rsvp` itself (§3.8) — never a direct client
    // write to this collection.
    create: () => false,
    update: () => false,
    delete: () => false,
  },
  fields: [
    { name: 'fixture', type: 'relationship', relationTo: 'fixtures', required: true },
    { name: 'user', type: 'relationship', relationTo: 'users', required: true },
    {
      name: 'status',
      type: 'select',
      required: true,
      options: [
        { label: 'Zusage', value: 'yes' },
        { label: 'Absage', value: 'no' },
      ],
    },
    { name: 'respondedAt', type: 'date', defaultValue: () => new Date().toISOString() },
  ],
  indexes: [{ fields: ['fixture', 'user'], unique: true }],
};
