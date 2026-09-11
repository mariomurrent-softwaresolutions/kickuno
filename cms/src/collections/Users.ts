import type { CollectionConfig } from 'payload';

/**
 * Real auth (email + password) — implementation-plan.md §3.5. `strength`
 * lives on Memberships, not here, since it's a per-group rating (§3.1/§3.3).
 */
export const Users: CollectionConfig = {
  slug: 'users',
  auth: true,
  admin: {
    useAsTitle: 'name',
  },
  access: {
    // TODO(access): scope to "members of any group I share" instead of
    // world-readable, once Memberships-based access helpers exist (§3.4).
    read: () => true,
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
