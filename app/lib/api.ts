import * as SecureStore from 'expo-secure-store';

/**
 * Thin REST client for the Payload CMS backend — implementation-plan.md
 * §3.5/§3.6. Auth uses Payload's default JWT strategy: the token comes back
 * from /login (or /me) and is sent back as `Authorization: JWT <token>`
 * (Payload's own header scheme, not `Bearer`).
 */

const TOKEN_KEY = 'hallenkick.token';

function getApiBaseUrl(): string {
  // Set EXPO_PUBLIC_API_URL in app/.env (see app/.env.example) — e.g. your
  // Mac's LAN IP when testing on a physical device, since "localhost" from
  // the device/simulator won't reach a server running on your machine.
  return process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function getToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(TOKEN_KEY);
  } catch {
    return null;
  }
}

export async function setToken(token: string | null): Promise<void> {
  try {
    if (token) await SecureStore.setItemAsync(TOKEN_KEY, token);
    else await SecureStore.deleteItemAsync(TOKEN_KEY);
  } catch {
    // SecureStore unavailable (e.g. web) — auth just won't persist a reload.
  }
}

async function request<T>(
  path: string,
  opts: { method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'; body?: unknown; auth?: boolean } = {}
): Promise<T> {
  const { method = 'GET', body, auth = true } = opts;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  if (auth) {
    const token = await getToken();
    if (token) headers.Authorization = `JWT ${token}`;
  }

  let res: Response;
  try {
    res = await fetch(`${getApiBaseUrl()}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('Server nicht erreichbar. Läuft das CMS und ist EXPO_PUBLIC_API_URL richtig gesetzt?', 0);
  }

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;

  if (!res.ok) {
    const message =
      data?.errors?.[0]?.message ?? data?.error ?? data?.message ?? `Anfrage fehlgeschlagen (${res.status})`;
    throw new ApiError(message, res.status);
  }

  return data as T;
}

// --- Types (mirror the cms/src/collections shapes until payload-types.ts is wired in — §2) ---

export type ApiUser = {
  id: string;
  email: string;
  name: string;
  initials?: string;
  position?: 'tor' | 'abwehr' | 'mitte' | 'sturm';
};

/** Which collection a player id refers to — `users` (a real member) or `legacyPlayers` (an imported "ghost" profile, §3.7, phase 6). Every player-shaped id in the app is now paired with one of these. */
export type ApiPlayerKind = 'users' | 'legacyPlayers';

export type ApiGroupFeatures = { rsvp: boolean; autoBalance: boolean; strength: boolean };

export type ApiGroup = {
  id: string;
  name: string;
  inviteCode: string;
  /** Weekday index (0=Sonntag … 6=Samstag) "Neuer Termin" suggests by default — §4.5. */
  defaultGameDay: number;
  features: ApiGroupFeatures;
};

export type ApiMembership = {
  id: string;
  user: string | ApiUser;
  group: string | ApiGroup;
  role: 'admin' | 'organizer' | 'player';
};

export type ApiHall = {
  id: string;
  group: string | ApiGroup;
  name: string;
  capacity?: number;
  note?: string;
};

export type ApiFixture = {
  id: string;
  group: string | ApiGroup;
  season?: string;
  date: string;
  time: string;
  hall?: string | ApiHall;
  status: 'upcoming' | 'played';
  repeatGroupId?: string;
  /** Computed by Fixtures.ts's afterRead hook — not a real stored field. */
  rsvpYesCount?: number;
};

export type ApiRsvpSummary = { yesCount: number; myStatus: 'yes' | 'no' | null };

// --- Auth ---

export function login(email: string, password: string) {
  return request<{ user: ApiUser; token: string; exp: number }>('/api/users/login', {
    method: 'POST',
    body: { email, password },
    auth: false,
  });
}

export function register(name: string, email: string, password: string) {
  return request<{ doc: ApiUser; message: string }>('/api/users', {
    method: 'POST',
    body: { name, email, password },
    auth: false,
  });
}

export function me() {
  return request<{ user: ApiUser | null }>('/api/users/me');
}

// --- Groups / memberships ---

export function myMemberships() {
  // Memberships.access.read already scopes this to "my rows (+ rows I admin)"
  // — implementation-plan.md §3.4 — so no explicit `where` is needed here.
  return request<{ docs: ApiMembership[] }>('/api/memberships?depth=1&limit=10');
}

export function joinGroup(code: string) {
  return request<{ group: ApiGroup; membership: ApiMembership }>('/api/groups/join', {
    method: 'POST',
    body: { code },
  });
}

export function createGroup(name: string) {
  return request<{ doc: ApiGroup; message: string }>('/api/groups', {
    method: 'POST',
    body: { name },
  });
}

/**
 * Admin-only group edits — implementation-plan.md §3.8/§4.5/§4.6.
 * `features` should be sent in full (not a partial patch) — Payload's
 * update operation replaces a `group`-type field wholesale rather than
 * deep-merging its sub-fields, so a caller merges locally first.
 */
export function updateGroup(
  groupId: string,
  data: { name?: string; defaultGameDay?: number; features?: ApiGroupFeatures }
) {
  return request<{ doc: ApiGroup; message: string }>(`/api/groups/${groupId}`, {
    method: 'PATCH',
    body: data,
  });
}

// --- Group members / strength (§3.6, §4.5, phase 7) ---

export type ApiMemberRow = {
  /** Membership id — not the user id (use `user.id` for that, e.g. to link to Spielerprofil). */
  id: string;
  user: { id: string; name: string; initials?: string; position?: 'tor' | 'abwehr' | 'mitte' | 'sturm' } | null;
  role: 'admin' | 'organizer' | 'player';
  strength?: number;
  joinedAt?: string;
  /** Present only when the caller is admin/organizer (§3.3) — `null` until `played >= 5` this season. */
  suggestedStrength?: number | null;
  /** Present only when the caller is admin/organizer. */
  strengthSampleSize?: number;
};

export function getGroupMembers(groupId: string, opts?: { role?: 'admin' | 'organizer' | 'player'; q?: string }) {
  const qs = query({ role: opts?.role, q: opts?.q });
  return request<{ docs: ApiMemberRow[] }>(`/api/groups/${groupId}/members${qs}`);
}

export function regenerateInviteCode(groupId: string) {
  return request<{ doc: ApiGroup }>(`/api/groups/${groupId}/regenerate-code`, { method: 'POST' });
}

/** 403 if `group.features.strength` is off (§3.4/§3.6) — organizer/admin only. */
export function updateMembershipStrength(membershipId: string, strength: number) {
  return request<{ doc: unknown; message?: string }>(`/api/memberships/${membershipId}`, {
    method: 'PATCH',
    body: { strength },
  });
}

/** Sets `strength = suggestedStrength` — 400 if no suggestion yet, 403 if `group.features.strength` is off (§3.3/§3.6). */
export function applySuggestedStrength(membershipId: string) {
  return request<{ doc: unknown }>(`/api/memberships/${membershipId}/apply-suggested-strength`, { method: 'POST' });
}

// --- Fixtures / halls / rsvps (§3.6) ---

function query(params: Record<string, string | number | undefined>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    parts.push(`${key}=${encodeURIComponent(String(value))}`);
  }
  return parts.length ? `?${parts.join('&')}` : '';
}

export function listFixtures(groupId: string, status?: 'upcoming' | 'played') {
  const qs = query({
    'where[group][equals]': groupId,
    'where[status][equals]': status,
    depth: 1,
    sort: 'date',
    limit: 100,
  });
  return request<{ docs: ApiFixture[] }>(`/api/fixtures${qs}`);
}

export function getFixture(fixtureId: string) {
  return request<ApiFixture>(`/api/fixtures/${fixtureId}?depth=1`);
}

export function listHalls(groupId: string) {
  const qs = query({ 'where[group][equals]': groupId, limit: 100 });
  return request<{ docs: ApiHall[] }>(`/api/halls${qs}`);
}

export function createHall(data: { group: string; name: string }) {
  return request<{ doc: ApiHall; message: string }>('/api/halls', {
    method: 'POST',
    body: data,
  });
}

export function createFixture(data: { group: string; date: string; time: string; hall?: string }) {
  return request<{ doc: ApiFixture; message: string }>('/api/fixtures', {
    method: 'POST',
    body: data,
  });
}

export function createWeeklyFixtures(data: { group: string; date: string; time: string; hall?: string }) {
  return request<{ docs: ApiFixture[] }>('/api/fixtures/weekly', {
    method: 'POST',
    body: data,
  });
}

export function setRsvp(fixtureId: string, status: 'yes' | 'no') {
  return request<{ rsvp: unknown; yesCount: number }>(`/api/fixtures/${fixtureId}/rsvp`, {
    method: 'POST',
    body: { status },
  });
}

export function fixtureSummary(fixtureId: string) {
  return request<ApiRsvpSummary>(`/api/fixtures/${fixtureId}/summary`);
}

// --- Lineups / results (§3.6, §5) ---

export type ApiPlayerSummary = {
  id: string;
  name: string;
  initials?: string;
  position?: 'tor' | 'abwehr' | 'mitte' | 'sturm';
  /** Omitted by the server entirely when `features.strength` is off (§3.8). */
  strength?: number;
};

export type ApiLineup = {
  pool: ApiPlayerSummary[];
  red: ApiPlayerSummary[];
  green: ApiPlayerSummary[];
};

// The write shape (POST /result body) always sends plain ids; the read
// shape (GET /result, depth=1) comes back with `player` populated as an
// ApiUser object, same as `mvp` below. Both only ever reference real
// `users` — a *live* result is always recorded against that fixture's own
// lineup, which can never contain a `legacyPlayers` id (§3.7) — so no
// `kind` is needed on these two types.
export type ApiGoalEntry = { player: string | ApiUser; team: 'red' | 'green'; count: number };
export type ApiGoalEntryInput = { player: string; team: 'red' | 'green'; count: number };

export type ApiMatchResult = {
  id: string;
  fixture: string;
  redScore: number;
  greenScore: number;
  redOwnGoals: number;
  greenOwnGoals: number;
  mvp?: string | ApiUser;
  goals: ApiGoalEntry[];
  recordedBy?: string | ApiUser;
  recordedAt?: string;
  source: 'live' | 'import';
};

export function getLineup(fixtureId: string) {
  return request<ApiLineup>(`/api/fixtures/${fixtureId}/lineup`);
}

export function assignLineupPlayer(fixtureId: string, playerId: string, team: 'red' | 'green' | null) {
  return request<ApiLineup>(`/api/fixtures/${fixtureId}/lineup`, {
    method: 'PATCH',
    body: { playerId, team },
  });
}

export function autoBalanceLineup(fixtureId: string) {
  return request<ApiLineup>(`/api/fixtures/${fixtureId}/auto-balance`, {
    method: 'POST',
  });
}

export function getResult(fixtureId: string) {
  return request<{ result: ApiMatchResult | null }>(`/api/fixtures/${fixtureId}/result`);
}

export function saveResult(
  fixtureId: string,
  data: {
    redScore: number;
    greenScore: number;
    redOwnGoals?: number;
    greenOwnGoals?: number;
    mvp?: string;
    goals?: ApiGoalEntryInput[];
  }
) {
  return request<{ result: ApiMatchResult }>(`/api/fixtures/${fixtureId}/result`, {
    method: 'POST',
    body: data,
  });
}

// --- Stats / player profile (§3.6, §6, phase 5 — §3.7/phase 6 for legacyPlayers rows) ---

export type ApiStatsMetric = 'tore' | 'quote' | 'siege' | 'teilnahmen' | 'diff' | 'streak' | 'mvp' | 'eigen';

export const STATS_METRICS: { key: ApiStatsMetric; label: string }[] = [
  { key: 'tore', label: 'Tore' },
  { key: 'quote', label: 'Siegquote' },
  { key: 'siege', label: 'Siege' },
  { key: 'teilnahmen', label: 'Teilnahmen' },
  { key: 'diff', label: 'Torverhältnis' },
  { key: 'streak', label: 'Serie' },
  { key: 'mvp', label: 'MVP' },
  { key: 'eigen', label: 'Eigentore' },
];

export type ApiRankedRow = {
  rank: number;
  playerId: string;
  /** 'legacyPlayers' rows only ever appear here from phase 6 onward — an imported ghost profile ranks and links to Spielerprofil exactly like a real member. */
  playerKind: ApiPlayerKind;
  name: string;
  initials?: string;
  position?: 'tor' | 'abwehr' | 'mitte' | 'sturm';
  value: number;
  valueLabel: string;
  sub: string;
  pct: number;
};

export type ApiPodiumEntry = {
  rank: 1 | 2 | 3;
  playerId: string;
  playerKind: ApiPlayerKind;
  name: string;
  firstName: string;
  initials?: string;
  valueLabel: string;
};

export type ApiStatsResponse = {
  scope: 'season' | 'alltime';
  metric: ApiStatsMetric;
  rows: ApiRankedRow[];
  podium: ApiPodiumEntry[];
};

export function getStats(groupId: string, scope: 'season' | 'alltime', metric: ApiStatsMetric) {
  const qs = query({ group: groupId, scope, metric });
  return request<ApiStatsResponse>(`/api/stats${qs}`);
}

export type ApiPlayerProfile = {
  player: {
    id: string;
    kind: ApiPlayerKind;
    name: string;
    initials?: string;
    position?: 'tor' | 'abwehr' | 'mitte' | 'sturm';
    /** `users` only. */
    memberSinceYear?: number;
    /** `users` only — omitted entirely when `features.strength` is off (§3.8). */
    strength?: number;
    /** `users` only. */
    role?: 'admin' | 'organizer' | 'player';
    /** `legacyPlayers` only — e.g. "gespielt 2018–2021". */
    note?: string;
    /** `legacyPlayers` only — whether an admin has already merged this ghost profile into a real account (§3.7). */
    claimed?: boolean;
  };
  /** Most-recent-first, up to 5 entries. */
  form: ('S' | 'U' | 'N')[];
  season: {
    label: string;
    played: number;
    wins: number;
    draws: number;
    losses: number;
    goals: number;
    goalDiff: number;
    mvps: number;
    quote: number;
  };
  allTime: {
    played: number;
    wins: number;
    goals: number;
    quote: number;
    mvps: number;
    ownGoals: number;
  };
};

/**
 * `GET /api/players/:id/profile?group=&kind=` (phase 6) — replaces the old
 * `users`-scoped `/api/users/:id/profile`, which is gone now that a profile
 * can be either a real member or a `legacyPlayers` ghost profile (§3.7).
 * `kind` defaults to `'users'` so every existing call site (Statistik
 * before phase 6, "Mein Spielerprofil") keeps working unchanged.
 */
export function getPlayerProfile(playerId: string, groupId: string, kind: ApiPlayerKind = 'users') {
  const qs = query({ group: groupId, kind });
  return request<ApiPlayerProfile>(`/api/players/${playerId}/profile${qs}`);
}
