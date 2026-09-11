import type { CollectionConfig } from 'payload';
import { customAlphabet } from 'nanoid';

// No 0/O/1/I — avoids ambiguous invite codes read aloud or typed on a phone.
const generateInviteCode = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 6);

/** implementation-plan.md §3.1 (schema) + §3.8 (feature flags). */
export const Groups: CollectionConfig = {
  slug: 'groups',
  admin: { useAsTitle: 'name' },
  access: {
    // TODO(access): scope read to members of the group; scope update to
    // admins only (features especially — §3.4/§3.8) once Memberships-based
    // access helpers exist.
    read: () => true,
    update: () => true,
  },
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
