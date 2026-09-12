import type { CollectionConfig } from 'payload';

/**
 * Real auth (email + password) — implementation-plan.md §3.5. `strength`
 * lives on Memberships, not here, since it's a per-group rating (§3.1/§3.3).
 *
 * The old `/:id/profile` endpoint that used to live here (phase 5) has been
 * replaced by the root-level `GET /api/players/:id/profile?group=&kind=`
 * endpoint (`endpoints/player-profile.ts`, phase 6) — a profile can now be
 * either a real member or a `legacyPlayers` ghost profile, and that no
 * longer fits as a `users`-scoped endpoint.
 */
export const Users: CollectionConfig = {
  slug: 'users',
  auth: true,
  admin: {
    useAsTitle: 'name',
  },
  access: {
    // TODO(access): once fixtures/lineups/matchResults exist (§3.1), scope
    // this to "members of any group I share" — for now just require being
    // signed in at all, rather than the fully world-readable default. Signup
    // (`POST /api/users`) and login (`POST /api/users/login`) are unaffected
    // — those are Payload's own auth operations, not the `read` access
    // check below.
    read: ({ req }) => Boolean(req.user),
  },
  fields: [
    { name: 'name', type: 'text', required: true },
    {
      name: 'initials',
      type: 'text',
      admin: {
        readOnly: true,
        description: 'Computed from `name` — see the beforeChange hook below.',
      },
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
    {
      name: 'memberSince',
      type: 'date',
      defaultValue: () => new Date().toISOString(),
    },
    {
      name: 'avatarSeed',
      type: 'text',
      admin: { description: 'Optional — for a consistent avatar gradient in the app.' },
    },
  ],
};
