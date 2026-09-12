import type { PayloadRequest, Where } from 'payload';

/**
 * IDs of groups where `req.user` holds a membership matching `roles`
 * (defaults to any role). Used by collection `access` functions to build a
 * `{ id: { in: [...] } }` / `{ group: { in: [...] } }` constraint instead of
 * loading every row and filtering in memory — implementation-plan.md §3.4.
 */
export async function membershipGroupIds(
  req: PayloadRequest,
  opts?: { roles?: Array<'admin' | 'organizer' | 'player'> },
): Promise<(string | number)[]> {
  if (!req.user) return [];

  const where: Where = { user: { equals: req.user.id } };
  if (opts?.roles?.length) where.role = { in: opts.roles };

  const result = await req.payload.find({
    collection: 'memberships',
    where,
    pagination: false,
    depth: 0,
    // This helper runs *inside* an access-control function to compute the
    // constraint that access control will then apply — it must not
    // recursively re-trigger Memberships' own `read` access (which itself
    // calls this helper), so it deliberately bypasses access here.
    overrideAccess: true,
  });

  return result.docs.map((m) => (typeof m.group === 'object' && m.group !== null ? (m.group as { id: string | number }).id : (m.group as string | number)));
}
