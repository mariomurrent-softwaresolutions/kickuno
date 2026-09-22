import type { CollectionConfig } from 'payload';

import { ADMIN_PANEL_ALLOWED_EMAIL, isAdminPanelLoginEnabled } from '../lib/admin-access';
import { deleteAccount } from '../lib/account-deletion';

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
  // Payload's own default tokenExpiration is 7200s (2h) — far too short for
  // a mobile app that isn't reopened every couple of hours, and exactly
  // what caused "I get logged out after not using the app for a while"
  // (reported Sept 2026): once the JWT itself expires, `/refresh-token`
  // (which needs a still-valid token to mint a new one) can no longer save
  // the session, so the user is dropped back to login with no way back in
  // except re-entering their password. Raised to 60 days instead. This is
  // safe specifically because of how the token is stored on the client
  // (app/lib/api.ts): it lives in `expo-secure-store` — the OS's encrypted
  // keychain/keystore, not AsyncStorage or plain JS state — and is only
  // ever persisted there at all when the user opted into "Angemeldet
  // bleiben" (remember me) on login (app/app/(auth)/login.tsx); otherwise
  // it stays in memory only and the session doesn't survive an app restart.
  // `auth-context.tsx#maybeRefreshToken` proactively renews the token
  // (via /refresh-token) whenever less than a week of this lifetime
  // remains, checked on every app foreground/launch, so as long as a
  // "remembered" user opens the app at least once every ~53 days, their
  // session renews indefinitely —
  // they're only ever asked to log in again after a much longer stretch of
  // not using the app at all. Note this is a stateless JWT: there is no
  // server-side revocation list, so a leaked token from *before* a
  // password change or account deletion is not itself invalidated early —
  // same trade-off Payload's default already had, just over a longer
  // window now.
  auth: {
    tokenExpiration: 60 * 60 * 24 * 60, // 60 days, up from Payload's 2h default
  },
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
    {
      // Self-service account deletion (Profil screen, "Konto löschen" —
      // not in the original plan). Requires the current password, same
      // proof-of-identity check as /change-password above and for the
      // same reason: a bare valid session token isn't enough evidence the
      // caller actually wants this, only that some token exists — and
      // unlike a password change, this can't be undone.
      //
      // The actual cleanup — reassigning this account's match history to
      // a fresh `legacyPlayers` ghost profile per group (so other
      // members' stats stay correct), removing memberships, promoting a
      // replacement admin if this was a group's only one — all lives in
      // `lib/account-deletion.ts`; this handler just verifies the
      // password, delegates, then deletes the `users` document itself.
      path: '/delete-account',
      method: 'post',
      handler: async (req) => {
        if (!req.user || !req.user.email) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }
        const email = req.user.email;
        const userId = req.user.id;

        let body: Record<string, unknown> = {};
        try {
          body = (await req.json?.()) ?? {};
        } catch {
          // no/invalid JSON body — handled by the check below
        }

        const password = typeof body.password === 'string' ? body.password : '';
        if (!password) {
          return Response.json({ error: 'Passwort wird benötigt.' }, { status: 400 });
        }

        try {
          await req.payload.login({
            collection: 'users',
            data: { email, password },
            overrideAccess: true,
          });
        } catch {
          return Response.json({ error: 'Passwort ist falsch.' }, { status: 401 });
        }

        const transfers = await deleteAccount(req.payload, userId);
        await req.payload.delete({ collection: 'users', id: userId, overrideAccess: true });

        // `transfers` lists every group where this account was the sole
        // admin and someone else was promoted — the app shows this to the
        // person before dropping them to the login screen, so an admin
        // deleting their account isn't left wondering who runs their
        // group now.
        return Response.json({ message: 'Konto gelöscht.', transfers }, { status: 200 });
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
