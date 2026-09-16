import * as SecureStore from 'expo-secure-store';

/**
 * Thin REST client for the Payload CMS backend — implementation-plan.md
 * §3.5/§3.6. Auth uses Payload's default JWT strategy: the token comes back
 * from /login (or /me) and is sent back as `Authorization: JWT <token>`
 * (Payload's own header scheme, not `Bearer`).
 */

const TOKEN_KEY = 'hallenkick.token';
// Unix seconds the current JWT expires at (Payload's `exp`, from
// /login or /refresh-token) — stored alongside the token so the app can
// proactively refresh *before* it expires instead of finding out from a
// failed request.
const TOKEN_EXP_KEY = 'hallenkick.token.exp';

function getApiBaseUrl(): string {
  // Set EXPO_PUBLIC_API_URL in app/.env (see app/.env.example) — e.g. your
  // Mac's LAN IP when testing on a physical device, since "localhost" from
  // the device/simulator won't reach a server running on your machine.
  return process.env.EXPO_PUBLIC_API_URL ?? 'https://api-kickuno.meecode.at';
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

/** Unix seconds the stored token expires at, or `null` if unknown/not set. */
export async function getTokenExpiry(): Promise<number | null> {
  try {
    const raw = await SecureStore.getItemAsync(TOKEN_EXP_KEY);
    return raw ? Number(raw) : null;
  } catch {
    return null;
  }
}

export async function setToken(token: string | null): Promise<void> {
  try {
    if (token) await SecureStore.setItemAsync(TOKEN_KEY, token);
    else await SecureStore.deleteItemAsync(TOKEN_KEY);
    if (!token) await SecureStore.deleteItemAsync(TOKEN_EXP_KEY).catch(() => {});
  } catch {
    // SecureStore unavailable (e.g. web) — auth just won't persist a reload.
  }
}

/** Stores a token together with the `exp` (unix seconds) Payload returned for it — call this instead of `setToken` after /login or /refresh-token. */
export async function setSession(token: string, exp: number): Promise<void> {
  await setToken(token);
  try {
    await SecureStore.setItemAsync(TOKEN_EXP_KEY, String(exp));
  } catch {
    // SecureStore unavailable — refresh scheduling just won't have an exp to work from.
  }
}

/**
 * Called whenever a request comes back 401 (expired/invalid JWT). Every API
 * call still throws its own `ApiError` for the calling screen to show, but
 * without this the app had no way to notice the *session itself* is dead —
 * it just kept showing "Etwas ist schiefgelaufen" on every subsequent
 * screen instead of dropping back to the login screen. `auth-context.tsx`
 * registers this once to force a real sign-out.
 */
let unauthorizedHandler: (() => void) | null = null;
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
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
    // A 401 on an authenticated request means the JWT is expired or
    // otherwise invalid (Payload's default token lifetime is 2h and this
    // app never renewed it — see refreshToken() below). Clear the dead
    // token and tell auth-context so it can drop back to signedOut, rather
    // than leaving the app looking "logged in" while every call fails.
    if (res.status === 401 && auth) {
      void setToken(null);
      unauthorizedHandler?.();
    }
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
  /**
   * The app's own display language (feature-plan-i18n-localization.md) —
   * purely a client preference, `undefined` until the user picks one on the
   * Profil tab (the app falls back to the device's language, or German,
   * until then). Never consulted by the backend itself.
   */
  locale?: 'de' | 'en';
};

/** Which collection a player id refers to — `users` (a real member) or `legacyPlayers` (an imported "ghost" profile, §3.7, phase 6). Every player-shaped id in the app is now paired with one of these. */
export type ApiPlayerKind = 'users' | 'legacyPlayers';

export type ApiGroupFeatures = { rsvp: boolean; autoBalance: boolean; strength: boolean; mvp: boolean };

export type ApiGroup = {
  id: string;
  name: string;
  inviteCode: string;
  /** Weekday index (0=Sonntag … 6=Samstag) "Neuer Termin" suggests by default — §4.5. */
  defaultGameDay: number;
  features: ApiGroupFeatures;
  /**
   * Custom display names for the two teams (not in the original plan) —
   * purely cosmetic, shown wherever the app would otherwise print the
   * literal "Rot"/"Grün". Doesn't rename anything underneath (lineups'
   * `redPlayers`/`greenPlayers`, `matchResults.redScore`/`greenScore`, or
   * any `tint="red"|"green"` styling) — those stay keyed by color
   * regardless of what a group calls its teams. A group created before
   * this field existed won't have it set, so callers should fall back to
   * 'Rot'/'Grün'.
   */
  teamOneName?: string;
  teamTwoName?: string;
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

/**
 * Season-management feature plan §A. `status` replaces what used to be a
 * plain `isCurrent` boolean on the backend — exactly one season per group
 * holds `'active'` at a time (enforced server-side by `setActiveSeason`,
 * cms/src/lib/season.ts), the rest are `'completed'`.
 */
export type ApiSeason = {
  id: string;
  group?: string | ApiGroup;
  label: string;
  startDate?: string;
  endDate?: string;
  status: 'active' | 'completed';
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
  /**
   * Computed by Fixtures.ts's afterRead hook — not a real stored field.
   * Whether a `matchResults` row actually exists for this fixture.
   * Deliberately not the same thing as `status === 'played'`: `status` is
   * a plain editable field that can be set independently of an actual
   * result (verified live: `PATCH /api/fixtures/:id { status: 'played' }`
   * succeeds without ever creating a `matchResults` row), so the
   * Termine list's "Ergebnis vorhanden" dot needs this instead.
   */
  hasResult?: boolean;
  /** Present only when `hasResult` is true — the final, already-computed score (own goals folded in, see `ergebnis.tsx`). */
  redScore?: number;
  greenScore?: number;
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

/**
 * Payload's built-in `POST /api/{collection}/refresh-token` — extends the
 * current session by minting a fresh JWT (same tokenExpiration, i.e.
 * another ~2h from now), *without* asking for the password again. Only
 * works while the current token is still valid — a token that has already
 * expired comes back 401/403 here too, and the only way back in then is a
 * real re-login. auth-context.tsx calls this proactively (well before
 * expiry, and again on app foreground) so a user who keeps the app open
 * doesn't hit that expired-token dead end at all.
 */
export function refreshToken() {
  return request<{ user: ApiUser; exp: number; refreshedToken: string }>('/api/users/refresh-token', {
    method: 'POST',
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

/**
 * Persists the app's display-language choice (Profil tab) to the user's
 * own account, so it follows them to a new device/reinstall instead of
 * resetting to the phone's language every login — see
 * feature-plan-i18n-localization.md. Plain self-update, same
 * `access.update` rule every other own-profile edit already uses; no
 * dedicated endpoint needed the way `/change-password` is.
 */
export function updateLocale(userId: string, locale: 'de' | 'en') {
  return request<{ doc: ApiUser; message?: string }>(`/api/users/${userId}`, {
    method: 'PATCH',
    body: { locale },
  });
}

/**
 * `POST /api/users/change-password` (Users.ts) — not a plain
 * `PATCH /api/users/:id`, since that would accept a new password with no
 * proof the caller knows the current one. Throws `ApiError` with a
 * German message (e.g. wrong current password, new password too short)
 * that's safe to show as-is.
 */
export function changePassword(currentPassword: string, newPassword: string) {
  return request<{ message: string }>('/api/users/change-password', {
    method: 'POST',
    body: { currentPassword, newPassword },
  });
}

// --- Groups / memberships ---

export function myMemberships(userId: string) {
  // Memberships.access.read scopes reads to "my own rows, plus every row in
  // a group I admin/organize" (implementation-plan.md §3.4) — deliberately
  // broader than "just mine", for the Gruppe member-list screen. That means
  // an admin/organizer calling this without a `where` filter gets back
  // *everyone's* membership in their group(s), not just their own, and
  // `docs[0]` can end up being some other member's row instead of theirs
  // (found live: an admin ended up with `canEdit: false` because a
  // teammate's `role: 'player'` row came back first). Filtering explicitly
  // by `user` here is what actually makes this "my memberships".
  return request<{ docs: ApiMembership[] }>(
    `/api/memberships?where[user][equals]=${encodeURIComponent(userId)}&depth=1&limit=10`
  );
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
  data: { name?: string; defaultGameDay?: number; features?: ApiGroupFeatures; teamOneName?: string; teamTwoName?: string }
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
  /**
   * Present only when the caller is admin/organizer — the only one who can
   * edit it, from this same member-list screen. Everyone else only ever
   * sees a player's nickname on the team-builder screens (`ApiPlayerSummary`),
   * never here.
   */
  nickname?: string;
};

export function getGroupMembers(groupId: string, opts?: { role?: 'admin' | 'organizer' | 'player'; q?: string }) {
  const qs = query({ role: opts?.role, q: opts?.q });
  return request<{ docs: ApiMemberRow[] }>(`/api/groups/${groupId}/members${qs}`);
}

export function regenerateInviteCode(groupId: string) {
  return request<{ doc: ApiGroup }>(`/api/groups/${groupId}/regenerate-code`, { method: 'POST' });
}

// --- Seasons (feature plan §A) ---

export function getSeasons(groupId: string) {
  return request<{ docs: ApiSeason[] }>(`/api/groups/${groupId}/seasons`);
}

/** Admin/organizer only. Defaults to making the new season active (completing whichever season currently is). */
export function createSeason(groupId: string, data: { label?: string; startDate?: string; endDate?: string; makeActive?: boolean }) {
  return request<{ doc: ApiSeason }>(`/api/groups/${groupId}/seasons`, {
    method: 'POST',
    body: data,
  });
}

/** Admin/organizer only — 400 if the season isn't currently active. Doesn't create a replacement (§A: `getOrCreateCurrentSeason` seeds one lazily if needed). */
export function completeSeason(seasonId: string) {
  return request<{ doc: ApiSeason }>(`/api/seasons/${seasonId}/complete`, { method: 'POST' });
}

/** Admin/organizer only — reopens a completed season, completing whichever one was previously active. */
export function activateSeason(seasonId: string) {
  return request<{ doc: ApiSeason }>(`/api/seasons/${seasonId}/activate`, { method: 'POST' });
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

/** Admin/organizer only — same access as `updateMembershipStrength`. Pass `null`/`''` to clear it. */
export function updateMembershipNickname(membershipId: string, nickname: string | null) {
  return request<{ doc: unknown; message?: string }>(`/api/memberships/${membershipId}`, {
    method: 'PATCH',
    body: { nickname: nickname ?? '' },
  });
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

export function listFixtures(groupId: string, status?: 'upcoming' | 'played', seasonId?: string) {
  const qs = query({
    'where[group][equals]': groupId,
    'where[status][equals]': status,
    'where[season][equals]': seasonId,
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

export function createHall(data: { group: string; name: string; capacity?: number; note?: string }) {
  return request<{ doc: ApiHall; message: string }>('/api/halls', {
    method: 'POST',
    body: data,
  });
}

export function updateHall(hallId: string, data: { name?: string; capacity?: number | null; note?: string | null }) {
  return request<{ doc: ApiHall; message: string }>(`/api/halls/${hallId}`, {
    method: 'PATCH',
    body: data,
  });
}

/** 400 (surfaced via ApiError) if a fixture still references this hall — see Halls.ts's `beforeDelete` hook. */
export function deleteHall(hallId: string) {
  return request<{ doc: ApiHall; message: string }>(`/api/halls/${hallId}`, {
    method: 'DELETE',
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
  /**
   * A group-specific nickname (feature request: "add a nickname to each
   * player, display it only where we add them to a team") — present only
   * on the team-builder shapes that flow through `lib/lineup.ts`'s
   * `playerSummaries` (pool/red/green/notAttending), never on
   * Spielerprofil or Statistik's ranked rows.
   */
  nickname?: string;
};

/** `rsvpStatus`: `'no'` = explicitly declined, `'none'` = never responded. */
export type ApiNotAttendingPlayer = ApiPlayerSummary & { rsvpStatus: 'no' | 'none' };

export type ApiLineup = {
  pool: ApiPlayerSummary[];
  red: ApiPlayerSummary[];
  green: ApiPlayerSummary[];
  /**
   * Every other real group member — always empty when `features.rsvp` is
   * off (§4.5, not in the original plan). Assigning one of these via
   * `assignLineupPlayer` marks them attending server-side as a side
   * effect (see `PATCH /:id/lineup` on `Fixtures.ts`) — no separate RSVP
   * call needed from here.
   */
  notAttending: ApiNotAttendingPlayer[];
};

// The write shape (POST /result body) always sends plain ids; the read
// shape (GET /result, depth=1) comes back with `player` populated as an
// ApiUser object, same as `mvp` below. Both only ever reference real
// `users` — a *live* result is always recorded against that fixture's own
// lineup, which can never contain a `legacyPlayers` id (§3.7) — so no
// `kind` is needed on these two types.
export type ApiGoalEntry = { player: string | ApiUser; team: 'red' | 'green'; count: number; isOwnGoal?: boolean };
export type ApiGoalEntryInput = { player: string; team: 'red' | 'green'; count: number; isOwnGoal?: boolean };

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

export function assignLineupPlayer(fixtureId: string, playerId: string, team: 'red' | 'green' | 'none' | null) {
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

export type ApiStatsMetric =
  | 'tore'
  | 'quote'
  | 'siege'
  | 'niederlagen'
  | 'niederlagenquote'
  | 'teilnahmen'
  | 'diff'
  | 'streak'
  | 'mvp'
  | 'eigen';

export const STATS_METRICS: { key: ApiStatsMetric; label: string }[] = [
  { key: 'tore', label: 'Tore' },
  { key: 'quote', label: 'Siegquote' },
  { key: 'siege', label: 'Siege' },
  { key: 'niederlagen', label: 'Niederlagen' },
  { key: 'niederlagenquote', label: 'Niederlagenquote' },
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

export type ApiMatchExtreme = {
  fixtureId: string;
  date: string;
  redScore: number;
  greenScore: number;
};

export type ApiPlayerMatchHighlight = {
  playerId: string;
  playerKind: ApiPlayerKind;
  name: string;
  fixtureId: string;
  date: string;
  goals: number;
};

export type ApiLongestStreakHighlight = {
  playerId: string;
  playerKind: ApiPlayerKind;
  name: string;
  streak: number;
};

/** §B: all-time-only "Hall of Fame" — only ever set on `scope === 'alltime'` responses. */
export type ApiAllTimeRecords = {
  topSingleMatchGoals: ApiPlayerMatchHighlight | null;
  longestWinStreak: ApiLongestStreakHighlight | null;
};

export type ApiStatsResponse = {
  scope: 'season' | 'alltime';
  metric: ApiStatsMetric;
  rows: ApiRankedRow[];
  podium: ApiPodiumEntry[];
  /** Which season the rows/podium reflect — only set when `scope === 'season'` (§A). */
  seasonId?: string;
  /** Only set when `scope === 'alltime'` (§B) — season-scoped records live on `ApiStatsSummaryResponse` instead. */
  records?: ApiAllTimeRecords;
};

/** `seasonId` is only consulted when `scope === 'season'` — omit it to fall back to the group's active season (§A). */
export function getStats(groupId: string, scope: 'season' | 'alltime', metric: ApiStatsMetric, seasonId?: string) {
  const qs = query({ group: groupId, scope, metric, season: scope === 'season' ? seasonId : undefined });
  return request<ApiStatsResponse>(`/api/stats${qs}`);
}

/** §B: season-scoped match records — any of the three is `null` when the scope has no played matches. */
export type ApiSeasonRecords = {
  biggestWin: ApiMatchExtreme | null;
  closestGame: ApiMatchExtreme | null;
  highestScoring: ApiMatchExtreme | null;
};

export type ApiSeasonSummary = {
  /** Number of played fixtures (matches with a recorded result) in scope. */
  playedCount: number;
  totalGoals: number;
  /** Rounded to one decimal. 0 when `playedCount` is 0. */
  avgGoalsPerMatch: number;
  /** Mean lineup size (red + green) across matches in scope, rounded to one decimal. */
  avgAttendance: number;
  red: { wins: number; draws: number; losses: number };
  green: { wins: number; draws: number; losses: number };
  records: ApiSeasonRecords;
};

export type ApiDuoPlayerRef = {
  playerId: string;
  playerKind: ApiPlayerKind;
  name: string;
  initials?: string;
};

/** §C ("Beste Duos") — a pair of players and their shared-team record. */
export type ApiDuoStanding = {
  playerA: ApiDuoPlayerRef;
  playerB: ApiDuoPlayerRef;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  /** Rounded percentage, 0-100. */
  winRate: number;
};

export type ApiStatsSummaryResponse = {
  scope: 'summary';
  summary: ApiSeasonSummary;
  /** §C — top pairs by win rate when sharing a team, same scope as `summary`. Empty when no pair has met the minimum shared-games threshold yet. */
  bestDuos: ApiDuoStanding[];
  /** Echoes back the requested season id — undefined means all-time. */
  seasonId?: string;
};

/**
 * Group/season-level overview (`claude/feature-plan-stats-enhancements.md`
 * §A) — companion to `getStats()` above, which only ever ranks *players*.
 * `seasonId` omitted means all-time — unlike `getStats`'s `scope=season`,
 * there is no fallback-to-active-season here; resolve the season id
 * client-side first (the Statistik screen already does this for
 * `getStats` via `effectiveSeasonId`) and pass it in explicitly.
 */
export function getStatsSummary(groupId: string, seasonId?: string) {
  const qs = query({ group: groupId, scope: 'summary', season: seasonId });
  return request<ApiStatsSummaryResponse>(`/api/stats${qs}`);
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
    /** Omitted only in the edge case where the group has no active season and none was requested. */
    id?: string;
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
 * `GET /api/players/:id/profile?group=&kind=&season=` (phase 6, `season`
 * param added with the per-season Spielerprofil support) — replaces the
 * old `users`-scoped `/api/users/:id/profile`, which is gone now that a
 * profile can be either a real member or a `legacyPlayers` ghost profile
 * (§3.7). `kind` defaults to `'users'` so every existing call site
 * (Statistik before phase 6, "Mein Spielerprofil") keeps working
 * unchanged. `seasonId` is optional — omit it (as every call site did
 * before this) to get whichever season is currently active, same as
 * before.
 */
export function getPlayerProfile(playerId: string, groupId: string, kind: ApiPlayerKind = 'users', seasonId?: string) {
  const qs = query({ group: groupId, kind, season: seasonId });
  return request<ApiPlayerProfile>(`/api/players/${playerId}/profile${qs}`);
}
