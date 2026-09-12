import type { GlobalConfig } from 'payload';

import { ADMIN_PANEL_ALLOWED_EMAIL } from '../lib/admin-access';

/**
 * Master kill-switch for the Payload admin panel (`/admin`) — entirely
 * separate from app login (`POST /api/users/login`, untouched by this).
 * Defaults to `enabled: false`: until someone flips it on, nobody —
 * including the one account named below — can reach `/admin` at all.
 *
 * Turning this on does **not** open the panel to just anyone: `Users.ts`'s
 * `access.admin` still hard-restricts `/admin` to exactly one account —
 * whichever one's email matches `ADMIN_PANEL_ALLOWED_EMAIL`. The two
 * checks are independent and both must pass — this flag is a way to
 * instantly lock the panel (e.g. if that account's credentials are ever
 * suspected compromised) without touching the user account itself.
 *
 * `access.update` deliberately does *not* also require `enabled: true` —
 * that would make this a one-way switch, since once the panel is locked
 * nobody could get back into `/admin` to unlock it. Instead the allowed
 * account can always flip it via a plain authenticated REST call —
 * `POST /api/globals/admin-access { "enabled": true }` using their
 * normal app login token — regardless of the panel's current lock
 * state, then log into `/admin` once it's back on. Note it's `POST`,
 * not `PATCH`: Payload's REST API updates a *global* via `POST`; `PATCH`
 * only applies to documents inside a regular collection.
 */
export const AdminAccess: GlobalConfig = {
  slug: 'admin-access',
  label: 'CMS-Zugriff',
  access: {
    read: ({ req }) => req.user?.email === ADMIN_PANEL_ALLOWED_EMAIL,
    update: ({ req }) => req.user?.email === ADMIN_PANEL_ALLOWED_EMAIL,
  },
  fields: [
    {
      name: 'enabled',
      type: 'checkbox',
      defaultValue: false,
      label: 'Payload-Admin-Panel-Login aktivieren',
      admin: {
        description:
          'Schaltet nur den Zugriff auf /admin frei — App-Logins (POST /api/users/login) sind davon nicht betroffen. Auch wenn aktiviert, darf sich weiterhin nur ein einziger fest hinterlegter Account im Admin-Panel anmelden.',
      },
    },
  ],
};
