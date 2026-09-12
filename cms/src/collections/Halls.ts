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
