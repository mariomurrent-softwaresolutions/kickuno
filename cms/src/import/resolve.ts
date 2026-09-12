import type { Payload } from 'payload';

import type { PolyKind } from '../lib/polymorphic';

export type ResolvedPlayer = { kind: PolyKind; id: string | number; name: string };

/**
 * CLI-only escape hatch for a name a group's current-member/legacyPlayers
 * index can't disambiguate on its own (two players who share a name, or a
 * spelling in the spreadsheet that doesn't match anyone) — implementation-
 * plan.md §3.7 calls for the admin to "manually map any ambiguous ones" at
 * preview time; since there's no `/admin/import` UI (§3.7's own
 * recommendation to ship CLI-only first), that mapping is this JSON file
 * instead: `{ "Exact CSV Name": { "kind": "users" | "legacyPlayers", "id": "..." } }`,
 * passed via `--aliases=./aliases.json`. An alias always wins over the
 * automatic name index, matched on the exact raw CSV string (not
 * case/whitespace-normalized) so it's unambiguous which row it targets.
 */
export type PlayerAliasMap = Record<string, { kind: PolyKind; id: string | number }>;

export type NameResolution =
  | { status: 'resolved'; player: ResolvedPlayer }
  | { status: 'ambiguous'; candidates: ResolvedPlayer[] }
  | { status: 'unresolved' };

export type PlayerIndex = {
  resolve(rawName: string): NameResolution;
  /** Registers a just-created `legacyPlayers` row so later rows in the same run (or same name repeated) resolve to it too, instead of creating a duplicate. */
  remember(name: string, player: ResolvedPlayer): void;
};

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Builds the name → player index for one group: every current member
 * (`memberships` → `users`) plus every existing `legacyPlayers` row.
 * Two people (or a member and a legacy row) sharing a normalized name
 * produce an `ambiguous` result rather than picking one arbitrarily.
 */
export async function buildPlayerIndex(
  payload: Payload,
  groupId: string | number,
  aliases: PlayerAliasMap = {},
): Promise<PlayerIndex> {
  const [members, legacy] = await Promise.all([
    payload.find({
      collection: 'memberships',
      where: { group: { equals: groupId } },
      pagination: false,
      depth: 1,
      overrideAccess: true,
    }),
    payload.find({
      collection: 'legacyPlayers',
      where: { group: { equals: groupId } },
      pagination: false,
      depth: 0,
      overrideAccess: true,
    }),
  ]);

  const byName = new Map<string, ResolvedPlayer[]>();
  const add = (name: string, ref: ResolvedPlayer) => {
    const key = normalizeName(name);
    const list = byName.get(key) ?? [];
    list.push(ref);
    byName.set(key, list);
  };

  for (const m of members.docs) {
    const user = typeof m.user === 'object' && m.user !== null ? (m.user as { id: string | number; name: string }) : null;
    if (user?.name) add(user.name, { kind: 'users', id: user.id, name: user.name });
  }
  for (const l of legacy.docs) {
    if (l.name) add(l.name as string, { kind: 'legacyPlayers', id: l.id, name: l.name as string });
  }

  return {
    resolve(rawName: string): NameResolution {
      const alias = aliases[rawName];
      if (alias) return { status: 'resolved', player: { ...alias, name: rawName } };

      const candidates = byName.get(normalizeName(rawName)) ?? [];
      if (candidates.length === 1) return { status: 'resolved', player: candidates[0] };
      if (candidates.length > 1) return { status: 'ambiguous', candidates };
      return { status: 'unresolved' };
    },
    remember(name: string, player: ResolvedPlayer) {
      add(name, player);
    },
  };
}

/** Case-insensitive exact-name lookup of an existing hall within the group. */
export async function findHallByName(payload: Payload, groupId: string | number, name: string) {
  const { docs } = await payload.find({
    collection: 'halls',
    where: { group: { equals: groupId } },
    pagination: false,
    depth: 0,
    overrideAccess: true,
  });
  return docs.find((h) => String(h.name).trim().toLowerCase() === name.trim().toLowerCase());
}

/** Finds a hall by name, or creates one — a group's historic spreadsheet shouldn't have to pre-create every hall it ever played in. */
export async function findOrCreateHall(
  payload: Payload,
  groupId: string | number,
  name: string,
): Promise<{ doc: { id: string | number }; created: boolean }> {
  const existing = await findHallByName(payload, groupId, name);
  if (existing) return { doc: existing, created: false };
  const doc = await payload.create({
    collection: 'halls',
    data: { group: groupId, name: name.trim() },
    overrideAccess: true,
  });
  return { doc, created: true };
}

/** Case-insensitive exact-label lookup of an existing season within the group. */
export async function findSeasonByLabel(payload: Payload, groupId: string | number, label: string) {
  const { docs } = await payload.find({
    collection: 'seasons',
    where: { group: { equals: groupId } },
    pagination: false,
    depth: 0,
    overrideAccess: true,
  });
  return docs.find((s) => String(s.label).trim().toLowerCase() === label.trim().toLowerCase());
}

/**
 * Finds a season by label, or creates one — never flipped `isCurrent` on an
 * existing season (a historic import should never silently change which
 * season the app currently defaults new fixtures onto); only made current
 * itself if the group has no current season at all yet.
 */
export async function findOrCreateSeason(
  payload: Payload,
  groupId: string | number,
  label: string,
): Promise<{ doc: { id: string | number }; created: boolean }> {
  const existing = await findSeasonByLabel(payload, groupId, label);
  if (existing) return { doc: existing, created: false };

  const currentExists = await payload.find({
    collection: 'seasons',
    where: { group: { equals: groupId }, isCurrent: { equals: true } },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  });
  const doc = await payload.create({
    collection: 'seasons',
    data: { group: groupId, label: label.trim(), isCurrent: currentExists.docs.length === 0 },
    overrideAccess: true,
  });
  return { doc, created: true };
}
