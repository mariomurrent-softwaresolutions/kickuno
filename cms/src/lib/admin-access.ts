import type { Payload } from 'payload';

/**
 * The one account ever allowed to reach the Payload admin panel. See
 * Users.ts's `access.admin` and `globals/AdminAccess.ts`'s `enabled`
 * kill-switch. Checked by email rather than Mongo `_id` — an ObjectId is
 * only ever valid within the one database it was generated in, so a
 * hardcoded id silently locks out this account the moment it's checked
 * against a different environment/reseed (a fresh `npm run dev` against a
 * new local Mongo, a staging DB, a restored backup, ...); email is the
 * one identity that's actually meant to stay stable across all of those.
 * This gates the admin UI *only* — it has no bearing on the app's own
 * auth (`POST /api/users/login`), which every user keeps using exactly as
 * before.
 */
export const ADMIN_PANEL_ALLOWED_EMAIL = 'mario@murrent.at';

/**
 * Reads the `admin-access` global's `enabled` flag (defaults to `false`
 * until someone flips it on — see that global's own doc comment for why
 * `access.update` there doesn't itself depend on this flag). Called from
 * `Users.ts`'s `access.admin`, so it deliberately bypasses that global's
 * own `read` access control (`overrideAccess: true`) rather than trying
 * to evaluate access control from inside an access-control check.
 */
export async function isAdminPanelLoginEnabled(payload: Payload): Promise<boolean> {
  const settings = await payload.findGlobal({ slug: 'admin-access', overrideAccess: true });
  return Boolean(settings?.enabled);
}
