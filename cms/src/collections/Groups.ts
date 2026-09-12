import type { CollectionConfig } from 'payload';
import { customAlphabet } from 'nanoid';

import { membershipGroupIds } from '../access/helpers';
import { getOrCreateCurrentSeason } from '../lib/season';

// No 0/O/1/I — avoids ambiguous invite codes read aloud or typed on a phone.
const generateInviteCode = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 6);

/**
 * implementation-plan.md §3.1 (schema), §3.5 (create-a-group → auto-admin),
 * §3.6 (`POST /groups/join`, `GET /:id/members`, `POST /:id/regenerate-code`
 * — the latter two are phase 7), §3.8 (feature flags).
 */
export const Groups: CollectionConfig = {
  slug: 'groups',
  admin: { useAsTitle: 'name' },
  access: {
    // A member can read only the group(s) they belong to (§3.4). Joining a
    // *new* group by code goes through the `/join` endpoint below, which
    // looks the group up with `overrideAccess: true` — it doesn't need
    // world-readable groups to work.
    read: async ({ req }) => {
      if (!req.user) return false;
      const ids = await membershipGroupIds(req);
      if (ids.length === 0) return false;
      return { id: { in: ids } };
    },
    // Any authenticated user can create a group (they become its admin —
    // see the afterChange hook below). Signed-out users can't reach this at
    // all since `create` requires `req.user`.
    create: ({ req }) => Boolean(req.user),
    // Only admins of a group may edit it (name, features — §3.8).
    update: async ({ req }) => {
      if (!req.user) return false;
      const ids = await membershipGroupIds(req, { roles: ['admin'] });
      if (ids.length === 0) return false;
      return { id: { in: ids } };
    },
  },
  hooks: {
    beforeChange: [
      // `createdBy` is always the actual requesting user, never whatever a
      // client sends — this is what the afterChange hook below trusts to
      // decide who becomes admin.
      ({ req, data, operation }) => {
        if (operation === 'create' && req.user) {
          data.createdBy = req.user.id;
        }
        return data;
      },
    ],
    afterChange: [
      // §3.5: creating a group makes you its admin, automatically.
      async ({ req, doc, operation }) => {
        if (operation !== 'create' || !doc.createdBy) return;
        await req.payload.create({
          collection: 'memberships',
          data: {
            user: typeof doc.createdBy === 'object' ? doc.createdBy.id : doc.createdBy,
            group: doc.id,
            role: 'admin',
          },
          overrideAccess: true,
          req,
        });
        // Fixtures/rsvps always need a season to hang off of (§3.1) — seed a
        // sane default so admins don't have to set one up by hand first.
        await getOrCreateCurrentSeason(req.payload, doc.id);
      },
    ],
  },
  endpoints: [
    {
      path: '/join',
      method: 'post',
      handler: async (req) => {
        if (!req.user) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        let body: Record<string, unknown> = {};
        try {
          body = (await req.json?.()) ?? {};
        } catch {
          // no/invalid JSON body — handled by the `code` check below
        }

        const code = typeof body.code === 'string' ? body.code.trim().toUpperCase() : '';
        if (!code) {
          return Response.json({ error: 'code is required' }, { status: 400 });
        }

        const groups = await req.payload.find({
          collection: 'groups',
          where: { inviteCode: { equals: code } },
          limit: 1,
          overrideAccess: true,
        });
        const group = groups.docs[0];
        if (!group) {
          return Response.json({ error: 'Invalid invite code' }, { status: 404 });
        }

        const existing = await req.payload.find({
          collection: 'memberships',
          where: { user: { equals: req.user.id }, group: { equals: group.id } },
          limit: 1,
          overrideAccess: true,
        });

        if (existing.docs[0]) {
          return Response.json({ group, membership: existing.docs[0] }, { status: 200 });
        }

        const membership = await req.payload.create({
          collection: 'memberships',
          data: { user: req.user.id, group: group.id, role: 'player' },
          overrideAccess: true,
        });

        return Response.json({ group, membership }, { status: 201 });
      },
    },
    {
      // §3.4/§3.6, phase 7: Gruppe screen's member list. `strength` is
      // included for everyone (the roster shows it read-only to a regular
      // player); `suggestedStrength`/`strengthSampleSize` are added only for
      // an admin/organizer caller — a regular player never sees teammates'
      // computed ratings (§3.3).
      path: '/:id/members',
      method: 'get',
      handler: async (req) => {
        if (!req.user) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const groupId = req.routeParams?.id;
        if (typeof groupId !== 'string' && typeof groupId !== 'number') {
          return Response.json({ error: 'Invalid group id' }, { status: 400 });
        }

        const myGroupIds = await membershipGroupIds(req);
        if (!myGroupIds.map(String).includes(String(groupId))) {
          return Response.json({ error: 'Forbidden' }, { status: 403 });
        }
        const isAdminOrOrganizer = (await membershipGroupIds(req, { roles: ['admin', 'organizer'] }))
          .map(String)
          .includes(String(groupId));

        const roleParam = req.query?.role;
        const role = roleParam === 'admin' || roleParam === 'organizer' || roleParam === 'player' ? roleParam : undefined;
        const q = typeof req.query?.q === 'string' ? req.query.q.trim().toLowerCase() : '';

        const { docs } = await req.payload.find({
          collection: 'memberships',
          where: { group: { equals: groupId } },
          pagination: false,
          depth: 1,
          overrideAccess: true,
        });

        const members = docs
          .filter((m) => (role ? m.role === role : true))
          .map((m) => {
            const user = typeof m.user === 'object' && m.user !== null ? m.user : null;
            return { m, user };
          })
          .filter(({ user }) => (q ? Boolean(user?.name?.toLowerCase().includes(q)) : true))
          .map(({ m, user }) => ({
            id: m.id,
            user: user
              ? { id: user.id, name: user.name, initials: user.initials ?? undefined, position: user.position ?? undefined }
              : null,
            role: m.role,
            strength: typeof m.strength === 'number' ? m.strength : undefined,
            joinedAt: m.joinedAt ?? undefined,
            ...(isAdminOrOrganizer
              ? {
                  suggestedStrength: typeof m.suggestedStrength === 'number' ? m.suggestedStrength : null,
                  strengthSampleSize: typeof m.strengthSampleSize === 'number' ? m.strengthSampleSize : 0,
                }
              : {}),
          }));

        return Response.json({ docs: members }, { status: 200 });
      },
    },
    {
      // §3.4/§3.6, phase 7: organizer/admin only. Generates a fresh code and
      // retries on the (astronomically unlikely) collision with an
      // existing one — `inviteCode` is `unique: true`.
      path: '/:id/regenerate-code',
      method: 'post',
      handler: async (req) => {
        if (!req.user) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const groupId = req.routeParams?.id;
        if (typeof groupId !== 'string' && typeof groupId !== 'number') {
          return Response.json({ error: 'Invalid group id' }, { status: 400 });
        }

        const adminGroupIds = await membershipGroupIds(req, { roles: ['admin', 'organizer'] });
        if (!adminGroupIds.map(String).includes(String(groupId))) {
          return Response.json({ error: 'Forbidden' }, { status: 403 });
        }

        let code = generateInviteCode();
        for (let attempt = 0; attempt < 5; attempt += 1) {
          // eslint-disable-next-line no-await-in-loop -- a handful of attempts at most; collisions are astronomically unlikely with a 6-char, 32-symbol alphabet.
          const clash = await req.payload.find({
            collection: 'groups',
            where: { inviteCode: { equals: code } },
            limit: 1,
            overrideAccess: true,
          });
          if (clash.docs.length === 0) break;
          code = generateInviteCode();
        }

        const doc = await req.payload.update({ collection: 'groups', id: groupId, data: { inviteCode: code }, overrideAccess: true });
        return Response.json({ doc }, { status: 200 });
      },
    },
  ],
  fields: [
    { name: 'name', type: 'text', required: true },
    {
      name: 'inviteCode',
      type: 'text',
      unique: true,
      admin: {
        readOnly: true,
        description: 'Auto-generated on create. Regenerating is a custom endpoint, not a plain edit — §3.6.',
      },
      hooks: {
        beforeValidate: [({ value }) => (typeof value === 'string' && value.length > 0 ? value : generateInviteCode())],
      },
    },
    { name: 'createdBy', type: 'relationship', relationTo: 'users' },
    {
      name: 'defaultGameDay',
      type: 'number',
      min: 0,
      max: 6,
      defaultValue: 4,
      admin: {
        description:
          'Weekday index (0=Sonntag … 6=Samstag) that "Neuer Termin" suggests by default (§4.5) — admin-editable via PATCH /api/groups/:id, same as `features` below. Unlike those flags, this changes what the date picker *suggests*, not what functionality is available — picking any other date always stays possible client-side.',
      },
    },
    {
      name: 'features',
      type: 'group',
      admin: {
        description: 'Admin-only toggles — implementation-plan.md §3.8. Enforce server-side on the gated endpoints, not just here.',
      },
      fields: [
        { name: 'rsvp', type: 'checkbox', defaultValue: true },
        { name: 'autoBalance', type: 'checkbox', defaultValue: true },
        { name: 'strength', type: 'checkbox', defaultValue: true },
      ],
    },
  ],
};
