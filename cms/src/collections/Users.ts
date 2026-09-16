import type { CollectionConfig } from 'payload';

import { ADMIN_PANEL_ALLOWED_EMAIL, isAdminPanelLoginEnabled } from '../lib/admin-access';

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
    // Locks down /admin itself (the Payload admin panel), not app login —
    // `POST /api/users/login` and every real app user keep working exactly
    // as before, regardless of this. Two ways in: the hardcoded
    // `ADMIN_PANEL_ALLOWED_EMAIL` fallback account (always eligible, can
    // never be locked out via the checkbox below), or any account with its
    // own `adminPanelAccess` checkbox on — see that field's own comment for
    // who can grant/revoke it. Either way, `/admin` only actually opens
    // once the `admin-access` global's `enabled` flag is switched on too
    // (defaults to off — see that global's own doc comment for the
    // reasoning and how to flip it on without a chicken-and-egg lockout).
    admin: async ({ req }) => {
      if (!req.user) return false;
      const eligible = req.user.email === ADMIN_PANEL_ALLOWED_EMAIL || req.user.adminPanelAccess === true;
      if (!eligible) return false;
      return isAdminPanelLoginEnabled(req.payload);
    },
    // Public signup (§3.5) — anyone signed out can create an account via
    // `POST /api/users` (login.tsx's "Registrieren" mode). This was never
    // actually set, on any commit back to the very first one: Payload's own
    // default for an *unspecified* access key isn't "allow everyone", it's
    // `defaultAccess = ({ req: { user } }) => Boolean(user)` — i.e.
    // "signed-in users only" — so anonymous registration has actually been
    // rejected with 403 this whole time. Surfaced only now, while adding
    // change-password verification (§ below), by a from-scratch registration
    // test — nothing about registration itself changed here.
    create: () => true,
    // TODO(access): once fixtures/lineups/matchResults exist (§3.1), scope
    // this to "members of any group I share" — for now just require being
    // signed in at all, rather than the fully world-readable default. Signup
    // (`POST /api/users`) and login (`POST /api/users/login`) are unaffected
    // — those are Payload's own auth operations, not the `read` access
    // check below.
    read: ({ req }) => Boolean(req.user),
    // Everyone can update their own document (name/position/avatar, and the
    // change-password endpoint below updates via this same access check) —
    // previously this was left unset, which defaults to "anyone signed in
    // may update anyone's document", a real gap once a self-service
    // change-password endpoint exists (it would let any signed-in user
    // PATCH `password` directly onto any other account, bypassing that
    // endpoint's current-password check entirely). An admin-panel-eligible
    // account (see `adminPanelAccess` below) additionally keeps full update
    // access to every user document — needed so it can flip *another*
    // account's `adminPanelAccess` field (already tested — see
    // getting-started.md), and consistent with such an account already
    // being able to edit any user from the actual /admin panel once the
    // global CMS-access switch is on.
    update: ({ req }) => {
      if (!req.user) return false;
      if (req.user.email === ADMIN_PANEL_ALLOWED_EMAIL || req.user.adminPanelAccess === true) return true;
      return { id: { equals: req.user.id } };
    },
  },
  endpoints: [
    {
      // Self-service password change for the app's Profil screen — not a
      // plain PATCH, because that would accept a new password with no proof
      // the caller actually knows the current one (a stolen/leaked JWT
      // alone would otherwise be enough to lock the real owner out).
      // Verifies the current password the same way `POST /api/users/login`
      // does — by calling Payload's own `login` operation — so it shares
      // that operation's login-attempt tracking/lockout policy rather than
      // reimplementing password comparison here. Entirely additive: real
      // app login (`POST /api/users/login`) is untouched.
      path: '/change-password',
      method: 'post',
      handler: async (req) => {
        if (!req.user || !req.user.email) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }
        const email = req.user.email;

        let body: Record<string, unknown> = {};
        try {
          body = (await req.json?.()) ?? {};
        } catch {
          // no/invalid JSON body — handled by the checks below
        }

        const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : '';
        const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';

        if (!currentPassword || !newPassword) {
          return Response.json({ error: 'Aktuelles und neues Passwort werden benötigt.' }, { status: 400 });
        }
        if (newPassword.length < 8) {
          return Response.json({ error: 'Neues Passwort muss mindestens 8 Zeichen haben.' }, { status: 400 });
        }

        try {
          await req.payload.login({
            collection: 'users',
            data: { email, password: currentPassword },
            overrideAccess: true,
          });
        } catch {
          return Response.json({ error: 'Aktuelles Passwort ist falsch.' }, { status: 401 });
        }

        await req.payload.update({
          collection: 'users',
          id: req.user.id,
          data: { password: newPassword },
          overrideAccess: true,
        });

        return Response.json({ message: 'Passwort geändert.' }, { status: 200 });
      },
    },
  ],
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
      name: 'locale',
      type: 'select',
      options: [
        { label: 'Deutsch', value: 'de' },
        { label: 'English', value: 'en' },
      ],
      admin: {
        description:
          "The app's own display language for this account (feature-plan-i18n-localization.md) — " +
          'purely a client-side preference, no effect on anything the backend generates. Left unset ' +
          "until the user picks one; the app falls back to the device's language (or German) until then.",
      },
    },
    {
      name: 'avatarSeed',
      type: 'text',
      admin: { description: 'Optional — for a consistent avatar gradient in the app.' },
    },
    {
      name: 'adminPanelAccess',
      type: 'checkbox',
      defaultValue: false,
      label: 'Admin-Panel-Zugriff',
      admin: {
        description:
          'Erlaubt diesem Account, sich im Payload-Admin-Panel anzumelden (zusätzlich dazu muss der globale CMS-Zugriff-Schalter aktiviert sein). Nur ein Account mit Admin-Panel-Zugriff (oder der fest hinterlegte Fallback-Account) kann dieses Feld ändern.',
      },
      access: {
        // Never settable at signup (`POST /api/users` is open to anyone —
        // §3.4), regardless of what a signup payload tries to include.
        create: () => false,
        // Only visible to/editable by someone who already has admin-panel
        // access themselves — either the hardcoded fallback account or a
        // previously-granted `adminPanelAccess` account — so a regular app
        // user can never see or flip this on any user's document (their
        // own included) via the API.
        read: ({ req }) =>
          req.user != null &&
          (req.user.email === ADMIN_PANEL_ALLOWED_EMAIL || req.user.adminPanelAccess === true),
        update: ({ req }) =>
          req.user != null &&
          (req.user.email === ADMIN_PANEL_ALLOWED_EMAIL || req.user.adminPanelAccess === true),
      },
    },
  ],
};
