import type { CollectionConfig } from 'payload';

import { membershipGroupIds } from '../access/helpers';

/**
 * implementation-plan.md §3.1. One group can have several seasons over
 * time; `isCurrent` marks the active one fixtures default onto (see
 * `cms/src/lib/season.ts`). Same access shape as Halls — §3.4.
 */
export const Seasons: CollectionConfig = {
  slug: 'seasons',
  admin: { useAsTitle: 'label' },
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
    { name: 'label', type: 'text', required: true, admin: { description: 'e.g. "25/26"' } },
    { name: 'startDate', type: 'date' },
    { name: 'endDate', type: 'date' },
    { name: 'isCurrent', type: 'checkbox', defaultValue: false },
  ],
};
