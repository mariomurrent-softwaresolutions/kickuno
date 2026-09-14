import type { CollectionConfig } from 'payload';

import { membershipGroupIds } from '../access/helpers';
import { setActiveSeason } from '../lib/season';

/**
 * implementation-plan.md §3.1, extended by the season-management feature
 * plan (\`claude/feature-plan-seasons-and-multigroup.md\` §A): one group can
 * have several seasons over time; exactly one may hold \`status: 'active'\`
 * at once — fixtures/results/stats default onto whichever that is (see
 * \`cms/src/lib/season.ts\`). The other status a season can hold is
 * \`'completed'\` — set either by an admin/organizer explicitly finishing a
 * season (\`POST /:id/complete\`) or automatically whenever a different
 * season is made active (\`setActiveSeason\`, used by both
 * \`POST /groups/:id/seasons\` and \`POST /:id/activate\` below). Same access
 * shape as Halls — §3.4.
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
  endpoints: [
    {
      // Admin/organizer only, and only onto a season belonging to a group
      // they actually manage — marks an *active* season completed. Doesn't
      // create a replacement itself: \`getOrCreateCurrentSeason\` lazily seeds
      // a default-labeled active season the next time one is needed (a new
      // fixture, a \`scope=season\` stats call with no explicit \`season\` id)
      // if this leaves the group with none — same belt-and-suspenders
      // fallback it already provides for a brand-new group.
      path: '/:id/complete',
      method: 'post',
      handler: async (req) => {
        if (!req.user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

        const seasonId = req.routeParams?.id;
        if (typeof seasonId !== 'string' && typeof seasonId !== 'number') {
          return Response.json({ error: 'Invalid season id' }, { status: 400 });
        }

        const season = await req.payload.findByID({ collection: 'seasons', id: seasonId, depth: 0, overrideAccess: true });
        if (!season) return Response.json({ error: 'Not found' }, { status: 404 });

        const groupId = typeof season.group === 'object' && season.group !== null ? season.group.id : season.group;
        const managedGroupIds = await membershipGroupIds(req, { roles: ['admin', 'organizer'] });
        if (!managedGroupIds.map(String).includes(String(groupId))) {
          return Response.json({ error: 'Forbidden' }, { status: 403 });
        }

        if (season.status !== 'active') {
          return Response.json({ error: 'Saison ist nicht aktiv.' }, { status: 400 });
        }

        const doc = await req.payload.update({ collection: 'seasons', id: seasonId, data: { status: 'completed' }, overrideAccess: true });
        return Response.json({ doc }, { status: 200 });
      },
    },
    {
      // Admin/organizer only — reopens a completed season, making it active
      // again and completing whichever season currently holds that status
      // (\`setActiveSeason\`). For fixing a mistaken rollover, not part of the
      // everyday flow.
      path: '/:id/activate',
      method: 'post',
      handler: async (req) => {
        if (!req.user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

        const seasonId = req.routeParams?.id;
        if (typeof seasonId !== 'string' && typeof seasonId !== 'number') {
          return Response.json({ error: 'Invalid season id' }, { status: 400 });
        }

        const season = await req.payload.findByID({ collection: 'seasons', id: seasonId, depth: 0, overrideAccess: true });
        if (!season) return Response.json({ error: 'Not found' }, { status: 404 });

        const groupId = typeof season.group === 'object' && season.group !== null ? season.group.id : season.group;
        const managedGroupIds = await membershipGroupIds(req, { roles: ['admin', 'organizer'] });
        if (!managedGroupIds.map(String).includes(String(groupId))) {
          return Response.json({ error: 'Forbidden' }, { status: 403 });
        }

        if (season.status !== 'active') {
          await setActiveSeason(req.payload, groupId, seasonId);
        }

        const doc = await req.payload.findByID({ collection: 'seasons', id: seasonId, depth: 0, overrideAccess: true });
        return Response.json({ doc }, { status: 200 });
      },
    },
  ],
  fields: [
    { name: 'group', type: 'relationship', relationTo: 'groups', required: true },
    { name: 'label', type: 'text', required: true, admin: { description: 'e.g. "25/26"' } },
    { name: 'startDate', type: 'date' },
    { name: 'endDate', type: 'date' },
    {
      name: 'status',
      type: 'select',
      defaultValue: 'active',
      options: [
        { label: 'Aktiv', value: 'active' },
        { label: 'Abgeschlossen', value: 'completed' },
      ],
      admin: {
        description:
          "Exactly one season per group should be 'active' at a time — enforced by setActiveSeason (cms/src/lib/season.ts) and the endpoints that call it, not by this field definition alone.",
      },
    },
  ],
};
