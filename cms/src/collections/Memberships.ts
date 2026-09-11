import type { CollectionConfig } from 'payload';

/**
 * Join table: user × group, with the per-group role and strength rating.
 * implementation-plan.md §3.1 (schema) + §3.3 (suggestedStrength).
 */
export const Memberships: CollectionConfig = {
  slug: 'memberships',
  admin: { useAsTitle: 'id' },
  access: {
    // TODO(access): scope to "this membership's own group" — §3.4.
    read: () => true,
  },
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
      name: 'suggestedStrength',
      type: 'number',
      min: 1,
      max: 5,
      admin: {
        readOnly: true,
        description: 'Computed by the match-results hook, never written directly by a client — §3.3.',
      },
    },
    { name: 'strengthSampleSize', type: 'number', admin: { readOnly: true } },
    { name: 'strengthSuggestedAt', type: 'date', admin: { readOnly: true } },
    { name: 'joinedAt', type: 'date', defaultValue: () => new Date().toISOString() },
  ],
  indexes: [{ fields: ['user', 'group'], unique: true }],
};
