import type { CollectionConfig } from 'payload';

import { membershipGroupIds } from '../access/helpers';
import { claimLegacyPlayer } from '../lib/claim';

/**
 * Historic "ghost" profiles for people who appear in imported results but
 * never sign up for a real account — implementation-plan.md §3.1/§3.7,
 * phase 6. Read by any group member (Statistik/Spielerprofil need to show
 * them alongside real users); only an admin can create/edit/delete one
 * directly through the collection API — in practice almost every row here
 * is created by the import service (`cms/src/import/`) using
 * `overrideAccess: true`, which bypasses this entirely, same as every
 * other server-trusted write in this backend.
 */
export const LegacyPlayers: CollectionConfig = {
  slug: 'legacyPlayers',
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
      const ids = await membershipGroupIds(req, { roles: ['admin'] });
      return ids.length > 0;
    },
    update: async ({ req }) => {
      if (!req.user) return false;
      const ids = await membershipGroupIds(req, { roles: ['admin'] });
      if (ids.length === 0) return false;
      return { group: { in: ids } };
    },
    delete: async ({ req }) => {
      if (!req.user) return false;
      const ids = await membershipGroupIds(req, { roles: ['admin'] });
      if (ids.length === 0) return false;
      return { group: { in: ids } };
    },
  },
  fields: [
    { name: 'group', type: 'relationship', relationTo: 'groups', required: true },
    { name: 'name', type: 'text', required: true },
    {
      name: 'initials',
      type: 'text',
      admin: { readOnly: true, description: 'Computed from `name` — same hook logic as Users.ts.' },
      hooks: {
        beforeChange: [
          ({ siblingData }) => {
            const name = (siblingData?.name as string | undefined)?.trim();
            if (!name) return undefined;
            const [first, second] = name.split(/\s+/);
            return `${first?.[0] ?? ''}${second?.[0] ?? ''}`.toUpperCase();
          },
        ],
      },
    },
    {
      name: 'position',
      type: 'select',
      options: [
        { label: 'Tor', value: 'tor' },
        { label: 'Abwehr', value: 'abwehr' },
        { label: 'Mitte', value: 'mitte' },
        { label: 'Sturm', value: 'sturm' },
      ],
    },
    { name: 'note', type: 'text', admin: { description: 'e.g. "gespielt 2018–2021".' } },
    {
      name: 'claimedBy',
      type: 'relationship',
      relationTo: 'users',
      admin: {
        readOnly: true,
        description: 'Set once by POST /api/legacyPlayers/:id/claim, when this person rejoins with a real account (§3.7).',
      },
    },
  ],
  endpoints: [
    {
      // §3.7: "if someone from legacyPlayers rejoins and creates a real
      // account" — reassigns every polymorphic reference from this ghost
      // profile onto their real account (`lib/claim.ts`). Admin/organizer
      // only, and only onto a user who's actually a member of this legacy
      // player's group. Note: the plan's own prose writes this path with a
      // hyphen (`/api/legacy-players/:id/claim`); the real REST path
      // follows this collection's actual (camelCase) slug, same as every
      // other collection-scoped endpoint in this codebase.
      path: '/:id/claim',
      method: 'post',
      handler: async (req) => {
        if (!req.user) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const legacyId = req.routeParams?.id;
        if (typeof legacyId !== 'string' && typeof legacyId !== 'number') {
          return Response.json({ error: 'Invalid id' }, { status: 400 });
        }

        const body = (await req.json?.()) ?? {};
        const userId = body.userId;
        if (typeof userId !== 'string' && typeof userId !== 'number') {
          return Response.json({ error: 'userId is required' }, { status: 400 });
        }

        const legacy = await req.payload.findByID({ collection: 'legacyPlayers', id: legacyId, depth: 0, overrideAccess: true });
        if (!legacy) {
          return Response.json({ error: 'Not found' }, { status: 404 });
        }
        if (legacy.claimedBy) {
          return Response.json({ error: 'Already claimed' }, { status: 409 });
        }
        const groupId = typeof legacy.group === 'object' && legacy.group !== null ? legacy.group.id : legacy.group;

        const myAdminGroupIds = await membershipGroupIds(req, { roles: ['admin', 'organizer'] });
        if (!myAdminGroupIds.map(String).includes(String(groupId))) {
          return Response.json({ error: 'Forbidden' }, { status: 403 });
        }

        const membership = await req.payload.find({
          collection: 'memberships',
          where: { user: { equals: userId }, group: { equals: groupId } },
          limit: 1,
          depth: 0,
          overrideAccess: true,
        });
        if (membership.docs.length === 0) {
          return Response.json({ error: 'User is not a member of this group' }, { status: 400 });
        }

        await claimLegacyPlayer(req.payload, { legacyId, groupId, userId });

        return Response.json({ ok: true }, { status: 200 });
      },
    },
  ],
};
