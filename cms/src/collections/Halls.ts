import type { CollectionConfig } from 'payload';

import { membershipGroupIds } from '../access/helpers';

/**
 * implementation-plan.md §3.1. Halls belong to a group; every member can
 * read them (needed for the Neuer Termin hall picker), only organizer/admin
 * manage them (§3.4).
 */
export const Halls: CollectionConfig = {
  slug: 'halls',
  admin: { useAsTitle: 'name' },
  hooks: {
    beforeDelete: [
      // A hall referenced by an existing fixture can't just disappear —
      // `fixtures.hall` is a plain (non-polymorphic) relationship with no
      // cleanup hook of its own, so deleting one out from under a fixture
      // would leave that fixture's `hall` pointing at a now-missing doc
      // (populates as null, silently dropping "which hall" from Termine/
      // Termin-Detail with no warning). Blocking here is cheaper and safer
      // than teaching every hall-reading screen to handle a dangling
      // reference.
      async ({ req, id }) => {
        const referencing = await req.payload.find({
          collection: 'fixtures',
          where: { hall: { equals: id } },
          limit: 1,
          depth: 0,
          overrideAccess: true,
        });
        if (referencing.docs.length > 0) {
          throw new Error('Diese Halle wird noch von mindestens einem Termin verwendet und kann nicht gelöscht werden.');
        }
      },
    ],
  },
  access: {
    read: async ({ req }) => {
      if (!req.user) return false;
      const ids = await membershipGroupIds(req);
      if (ids.length === 0) return false;
      return { group: { in: ids } };
    },
    create: async ({ req }) => {
      if (!req.user) return false;
      const ids = await membershipGroupIds(req, { roles: ['admin', 'organizer'] });
      return ids.length > 0;
    },
    update: async ({ req }) => {
      if (!req.user) return false;
      const ids = await membershipGroupIds(req, { roles: ['admin', 'organizer'] });
      if (ids.length === 0) return false;
      return { group: { in: ids } };
    },
    delete: async ({ req }) => {
      if (!req.user) return false;
      const ids = await membershipGroupIds(req, { roles: ['admin', 'organizer'] });
      if (ids.length === 0) return false;
      return { group: { in: ids } };
    },
  },
  fields: [
    { name: 'group', type: 'relationship', relationTo: 'groups', required: true },
    { name: 'name', type: 'text', required: true },
    { name: 'capacity', type: 'number' },
    { name: 'note', type: 'text', admin: { description: 'e.g. "Standard · 16 Plätze"' } },
  ],
};
