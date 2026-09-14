import type { CollectionConfig, Where } from 'payload';

import { membershipGroupIds } from '../access/helpers';
import { ADMIN_PANEL_ALLOWED_EMAIL } from '../lib/admin-access';

/**
 * Join table: user × group, with the per-group role and strength rating.
 * implementation-plan.md §3.1 (schema), §3.3 (suggestedStrength), §3.4
 * (access control), §3.6 (`PATCH /:id`, `POST /:id/apply-suggested-strength`
 * — phase 7).
 */
export const Memberships: CollectionConfig = {
  slug: 'memberships',
  admin: { useAsTitle: 'id' },
  access: {
    // A member can read their own membership rows, plus every membership in
    // a group where they're admin/organizer (member-list screens, §4.5).
    read: async ({ req }) => {
      if (!req.user) return false;
      const adminGroupIds = await membershipGroupIds(req, { roles: ['admin', 'organizer'] });
      const or: Where[] = [{ user: { equals: req.user.id } }];
      if (adminGroupIds.length) or.push({ group: { in: adminGroupIds } });
      return { or };
    },
    // Normal app usage never creates a row here directly — the
    // `/groups/join` endpoint and the auto-admin-on-create hook do it
    // themselves, both with `overrideAccess: true`. A regular app account
    // still can't: letting any signed-in user hit this directly would let
    // a player grant themselves admin, or join a group without going
    // through invite-code validation at all. The one exception is exactly
    // who can already reach the CMS — an admin-panel-eligible account
    // (`ADMIN_PANEL_ALLOWED_EMAIL` or `adminPanelAccess === true`, same
    // check as `Users.ts`'s `access.admin`) — so a membership can now also
    // be added by hand from `/admin` (e.g. fixing up seed/import data, or
    // adding someone without going through an invite code), without
    // opening this up to the app's own public API surface.
    create: ({ req }) => {
      if (!req.user) return false;
      return req.user.email === ADMIN_PANEL_ALLOWED_EMAIL || req.user.adminPanelAccess === true;
    },
    // Admin/organizer of the *membership's own group* can edit it (role,
    // strength — §3.3/§3.4). A regular player can't edit their own row,
    // which is what keeps `strength` from being self-reported.
    update: async ({ req }) => {
      if (!req.user) return false;
      const adminGroupIds = await membershipGroupIds(req, { roles: ['admin', 'organizer'] });
      if (adminGroupIds.length === 0) return false;
      return { group: { in: adminGroupIds } };
    },
    // Only a group's admin can remove a member.
    delete: async ({ req }) => {
      if (!req.user) return false;
      const adminGroupIds = await membershipGroupIds(req, { roles: ['admin'] });
      if (adminGroupIds.length === 0) return false;
      return { group: { in: adminGroupIds } };
    },
  },
  hooks: {
    beforeChange: [
      // §3.6: "PATCH /api/memberships/:id — 403 if group.features.strength
      // is off." This is Payload's default collection update endpoint (not
      // a custom handler), so the flag check lives here instead — and only
      // blocks an actual `strength` change, never a `role` edit, which
      // stays available regardless of the flag.
      async ({ req, data, originalDoc, operation }) => {
        if (operation !== 'update' || typeof data.strength !== 'number' || data.strength === originalDoc?.strength) {
          return data;
        }
        const groupId = typeof originalDoc?.group === 'object' && originalDoc.group !== null ? originalDoc.group.id : originalDoc?.group;
        if (groupId) {
          const group = await req.payload.findByID({ collection: 'groups', id: groupId, depth: 0, overrideAccess: true });
          if (group && group.features?.strength === false) {
            throw new Error('Strength-Bearbeitung ist für diese Gruppe deaktiviert (features.strength).');
          }
        }
        return data;
      },
    ],
  },
  endpoints: [
    {
      // §3.3/§3.6: organizer/admin one-tap "Übernehmen" — sets
      // `strength = suggestedStrength`. 400 if there's no suggestion yet
      // (played < 5 this season), 403 if `features.strength` is off.
      path: '/:id/apply-suggested-strength',
      method: 'post',
      handler: async (req) => {
        if (!req.user) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const membershipId = req.routeParams?.id;
        if (typeof membershipId !== 'string' && typeof membershipId !== 'number') {
          return Response.json({ error: 'Invalid id' }, { status: 400 });
        }

        const membership = await req.payload.findByID({ collection: 'memberships', id: membershipId, depth: 0, overrideAccess: true });
        if (!membership) {
          return Response.json({ error: 'Not found' }, { status: 404 });
        }
        const groupId = typeof membership.group === 'object' && membership.group !== null ? membership.group.id : membership.group;

        const adminGroupIds = await membershipGroupIds(req, { roles: ['admin', 'organizer'] });
        if (!adminGroupIds.map(String).includes(String(groupId))) {
          return Response.json({ error: 'Forbidden' }, { status: 403 });
        }

        const group = await req.payload.findByID({ collection: 'groups', id: groupId, depth: 0, overrideAccess: true });
        if (group && group.features?.strength === false) {
          return Response.json({ error: 'features.strength is off for this group' }, { status: 403 });
        }

        if (typeof membership.suggestedStrength !== 'number') {
          return Response.json({ error: 'No suggestion available yet' }, { status: 400 });
        }

        const doc = await req.payload.update({
          collection: 'memberships',
          id: membershipId,
          data: { strength: membership.suggestedStrength },
          overrideAccess: true,
        });

        return Response.json({ doc }, { status: 200 });
      },
    },
  ],
  fields: [
    { name: 'user', type: 'relationship', relationTo: 'users', required: true },
    { name: 'group', type: 'relationship', relationTo: 'groups', required: true },
    {
      name: 'role',
      type: 'select',
      required: true,
      defaultValue: 'player',
      options: [
        { label: 'Admin', value: 'admin' },
        { label: 'Organisator', value: 'organizer' },
        { label: 'Spieler', value: 'player' },
      ],
    },
    {
      name: 'strength',
      type: 'number',
      min: 1,
      max: 5,
      defaultValue: 3,
      admin: { description: 'Admin/organizer-editable — never self-reported (§3.4).' },
    },
    {
      name: 'nickname',
      type: 'text',
      maxLength: 30,
      admin: {
        description:
          'Group-specific — shown only in the team-builder screens (pool/red/green chips), not on Spielerprofil, Statistik, or the Gruppe member list. Admin/organizer-editable, same access as `strength`.',
      },
    },
    {
      name: 'suggestedStrength',
      type: 'number',
      min: 1,
      max: 5,
      admin: {
        readOnly: true,
        description: 'Computed by recomputeSuggestedStrength() (cms/src/lib/strength.ts), called from Fixtures.ts\'s /:id/result handler — §3.3.',
      },
    },
    { name: 'strengthSampleSize', type: 'number', admin: { readOnly: true } },
    { name: 'strengthSuggestedAt', type: 'date', admin: { readOnly: true } },
    { name: 'joinedAt', type: 'date', defaultValue: () => new Date().toISOString() },
  ],
  indexes: [{ fields: ['user', 'group'], unique: true }],
};
