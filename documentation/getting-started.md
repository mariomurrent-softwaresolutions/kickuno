# Getting started

## Status (Phase 4 — Teams & results, per implementation-plan.md §9 — complete)

**Phases 2 and 3 are code-complete and now confirmed working end-to-end** —
login, group join/create, and the Termine/RSVP loop all run against a live
CMS (you ran `npm install` and tested it yourself). Along the way we also
found and fixed a real runtime bug: `(auth)/_layout.tsx` was redirecting to
`/(auth)/join` unconditionally whenever `status === 'needsGroup'`, including
while already rendering `join.tsx` itself (that layout wraps it too) — an
infinite self-redirect that surfaced as React's "Maximum update depth
exceeded". Fixed with a `useSegments()` check that skips the redirect once
already on `/join`.

**`cms/`** — four more collections, all typechecking clean:

- **`Lineups.ts`** (§3.1) — one row per fixture, `redPlayers`/`greenPlayers`
  (`users`-only for now — the plan's `[users, legacyPlayers]` polymorphic
  relation waits for phase 6's `legacyPlayers` collection). Locked down
  entirely (`read`/`create`/`update`/`delete` all hard-`false`), same
  pattern as `Rsvps.ts` — every legitimate read/write goes through
  `Fixtures.ts`'s endpoints instead:
  - `GET /fixtures/:id/lineup` — `{ pool, red, green }`, where `pool` is
    confirmed RSVPs when `features.rsvp` is on, every member otherwise
    (§3.8). Any group member can read it.
  - `PATCH /fixtures/:id/lineup` — manual assign/unassign one player
    (`{ playerId, team: 'red' | 'green' | null }`); always available
    regardless of flags. Admin/organizer only.
  - `POST /fixtures/:id/auto-balance` — server port of `autoTeams()` (§5):
    sort by `strength` desc → season goals desc (falls back to goals-only
    when `features.strength` is off), snake-distribute 4-at-a-time. 403 when
    `features.autoBalance` is off. Admin/organizer only.
  - Shared logic (eligible-pool resolution, strength/goals lookups, the
    `{id, name, initials, position, strength?}` summary shape) lives in
    `cms/src/lib/lineup.ts`.
- **`MatchResults.ts`** (§3.1) — one row per played fixture. Also locked
  down entirely; `Fixtures.ts` gained `GET`/`POST /fixtures/:id/result`
  (any member reads, admin/organizer saves). Saving flips the fixture to
  `status: 'played'` and triggers the stats recompute below. `importBatch`
  is omitted (phase 6's `importBatches` doesn't exist yet); `mvp` and
  `goals[].player` are `users`-only for the same reason `Lineups.ts`'s
  relations are.
- **`PlayerSeasonStats.ts`** / **`PlayerCareerStats.ts`** (§3.1) —
  aggregation caches, locked down entirely, rebuilt by
  `recomputeStatsForPlayers()` in `cms/src/lib/stats.ts` whenever a
  `matchResults` row is saved. Deliberately a **full recompute from
  scratch** (3 queries: played fixtures, lineups, matchResults for the
  group — then everything else in-memory) rather than an incremental
  update, so fixing a past score can never leave the cache inconsistent
  (§3.2). `baseline*` fields on `PlayerCareerStats` stay untouched — phase
  6's import seeds those.

Two things the plan describes that are **intentionally not implemented
yet**, both documented inline in code comments where they matter:

- **Own goals aren't attributed to a specific player.** `matchResults` only
  records `redOwnGoals`/`greenOwnGoals` at the team level (needed for the
  score itself); nothing in the schema says *which* player scored one. So
  `playerSeasonStats.ownGoals` / `playerCareerStats.matchOwnGoals` stay at
  0 always. Nothing downstream consumes a nonzero value yet — revisit only
  if `matchResults.goals` grows an "own goal" entry kind.
- **`memberships.suggestedStrength` (§3.3) is never recomputed.** The
  composite z-score formula is fully specified in the plan but not wired
  into the stats hook — a separate, non-blocking piece of work. Nothing
  consumes `suggestedStrength` yet (the Gruppe screen that would is phase
  7), so this is safe to leave for a later pass rather than blocking phase
  4 on it.

**`app/`** — real UI for team building and result entry:

- **`lib/api.ts`** — added `getFixture`, `getLineup`,
  `assignLineupPlayer`, `autoBalanceLineup`, `getResult`, `saveResult`, and
  the matching `ApiPlayerSummary`/`ApiLineup`/`ApiMatchResult`/
  `ApiGoalEntry` types.
- **`components/ui/stat-tile.tsx`**, **`player-chip.tsx`**,
  **`stepper.tsx`** (new, shared) — the grouped-stat-tile, red/green
  player chip, and goal-stepper primitives named in §4.2's component
  mapping table; each is written to be reused by later phases (Start's
  season tiles, Spielerprofil, Statistik), not just this screen.
- **`(tabs)/termine/[fixtureId]/index.tsx`** (Termin-Detail, real UI) —
  Zusagen/Eingeteilt/Balance stat row (Balance hidden when
  `features.strength` is off), Auto-Aufstellung + Zurücksetzen buttons
  (admin/organizer only; Auto-Aufstellung also hidden when
  `features.autoBalance` is off), Red/Green pools (tap a chip to
  unassign), unassigned pool (tap Rot/Grün to assign), and a CTA into
  Ergebnis erfassen that reads "erfassen" vs "bearbeiten" depending on
  whether a result already exists. Everything editable is gated
  client-side on `membership.role` — the backend enforces the same
  restriction independently.
- **`(tabs)/termine/[fixtureId]/ergebnis.tsx`** (Ergebnis erfassen, real
  UI) — big score readout derived live from the steppers (each side's
  score = that side's own goal total + the *other* side's own-goals
  counter), per-player goal steppers for both lineups, team-level own-goal
  counters, an MVP chip picker, save button. Pre-fills from the existing
  result when editing one already recorded.

Statistik and Spielerprofil are now real screens (phase 5, below); the
real Gruppe screen is still phase 7.

## Since phase 4: configurable game day (not in the original plan)

"Neuer Termin" originally suggested only the next 6 Thursdays, hardcoded
(`weekday 4`) — that matched the prototype's one-group assumption ("Rot
gegen Grün", Thursdays 20:00 — §1) but doesn't hold for every real group.
Fixed:

- **`cms/`** — `Groups.ts` gained `defaultGameDay` (number, 0=Sonntag …
  6=Samstag, defaults to 4/Donnerstag), admin-editable via the existing
  `PATCH /api/groups/:id` (no new endpoint needed).
- **`app/`** — `termine/neu.tsx`'s date picker now suggests the next 6
  occurrences of `group.defaultGameDay` instead of a hardcoded weekday, and
  gained an "Anderes Datum wählen" toggle exposing the next 28 calendar
  days (any weekday) as a compact chip grid — so picking an off-day fixture
  is always possible regardless of the group's default. `gruppe/
  einstellungen.tsx` is now a real (admin-only) screen — a weekday chip
  row for `defaultGameDay` plus the three §3.8 feature-flag switches, all
  PATCHing immediately — reachable from a new admin-only entry point on the
  still-placeholder Gruppe screen (the full member-list Gruppe screen is
  still phase 7; this one link was pulled forward since it had no other
  home yet). `AuthContext` gained `refreshGroup()` so a settings change is
  reflected immediately without a re-login.

## Since phase 4: a 5th "Profil" tab (deviates from §4.3)

The prototype's nav has exactly 4 tabs (Start/Termine/Statistik/Gruppe,
§4.3) with logout tucked into the still-unbuilt Gruppe screen (§4.5) — in
the meantime, "Abmelden" had been sitting as a dev-only link on the Start
screen. Replaced with a proper 5th bottom tab:

- **`(tabs)/profil/`** (new — `_layout.tsx` + `index.tsx`) — the signed-in
  user's own account: name/email/position, group name + role badge, a link
  into "Mein Spielerprofil" (`/spieler/:id` — still phase 5's placeholder,
  but now reachable), and the real Abmelden button. `ProfilIcon` added to
  `components/ui/icons.tsx`; `(tabs)/_layout.tsx`'s tab bar and `ICONS`
  array extended to 5 entries.
- This is intentionally distinct from Spielerprofil (`app/spieler/
  [playerId].tsx`, phase 5) — that screen shows *any* player's season/
  all-time stats and is reached by tapping a player anywhere in the app;
  Profil is "my account" and lives in the tab bar. The Start screen's old
  "Abmelden" text link was removed now that it has a real home.

## Status (Phase 5 — Statistics & profiles, per implementation-plan.md §9 — complete)

**`cms/`** — one new read-side library plus two endpoints, no new
collections (phase 5 only *reads* the phase 4 schema):

- **`cms/src/lib/stats-query.ts`** (new) — `computeGroupPlayerStats(payload,
  groupId, seasonId?)` builds one `PlayerStatsRow` per *current* group
  member (zero-defaulted), then overlays every played fixture's lineup +
  matchResult (same 3-query shape as `stats.ts`'s write-side recompute, but
  keeping the full chronological match list per player instead of folding
  straight into totals). A member who left the group after playing drops
  out entirely — same phase-6/`legacyPlayers` gap already documented in
  `stats.ts`. `currentWinStreak()`, `last5Form()`, and the 8-metric
  `metricValue`/`metricValueLabel`/`metricSub` functions were written to
  match the prototype's actual `support.js` source byte-for-byte (streak's
  "N×S" formatting, most-recent-first form array, `teilnahmen`'s hardcoded
  `/18` season-length assumption, `diff`'s odd-but-faithful negative-podium
  `pct` edge case) rather than guessing from the plan's summary table
  alone. `rankPlayersByMetric()` does the ranking (stable sort, no
  tiebreaker) and podium reordering (`[2nd, 1st, 3rd]` display order).
- **`GET /api/stats?group=&scope=season|alltime&metric=`** (new
  root-level endpoint, `cms/src/endpoints/stats.ts`, wired into
  `payload.config.ts`'s own `endpoints: []` — distinct from a collection's
  `endpoints`, which mount under `/api/<slug>/...`) — the Statistik
  screen's only data source: `{ scope, metric, rows, podium }`. Restricted
  to callers who belong to the requested group.
- **`GET /api/users/:id/profile?group=`** (new, on `Users.ts`,
  collection-scoped since a profile is naturally "one user's page") — the
  Spielerprofil screen's only data source: header info (name/initials/
  position/`strength` — read from the `memberships` row, not self-reported
  — /memberSinceYear/role), a rolling last-5 `form` (based on the player's
  most recent matches *overall*, not reset at the season boundary), and
  `season`/`allTime` stat objects. Restricted to callers who share a group
  with the profiled player; 404s if the player isn't (or never was) a
  member of that group.

**`app/`** — both real screens, replacing their `ComingSoonScreen`
placeholders:

- **`lib/api.ts`** — added `getStats`/`getPlayerProfile` plus
  `ApiStatsMetric`/`STATS_METRICS`/`ApiRankedRow`/`ApiPodiumEntry`/
  `ApiStatsResponse`/`ApiPlayerProfile`.
- **`(tabs)/statistik/index.tsx`** (real UI) — Saison/All-Time segmented
  toggle, a horizontally-scrolling row of the 8 metric chips, a 3-player
  podium (gold/silver/bronze rings + 92/70/56px bars, positioned
  silver/gold/bronze left-to-right, all derived client-side from each
  entry's `rank` — the server sends `valueLabel`/`initials`/`firstName`
  only), and the ranked list with an inline `pct`-based fill bar per row.
  Tapping the podium or any row opens that player's Spielerprofil.
  Independent of every feature flag (§4.6), same as the plan specifies.
- **`app/spieler/[playerId].tsx`** (real UI) — header (avatar-gradient
  initials circle — gradient seeded by player id, not yet tied to the
  unused `avatarSeed` field; name; position · Stärke · dabei seit), a
  last-5 form pill row (most-recent-first, colored win/draw/loss), a
  season stat grid (reusing `StatTile` — 6 tiles: Spiele/Tore/Siegquote/
  "S / U / N"/Torverhältnis/MVP, with the prototype's ink/gold/green/ink/
  sign-dependent/ink color mapping), and an all-time stat list (6 rows:
  Spiele gesamt/Tore gesamt/Siege gesamt/Siegquote all-time/MVP-Titel/
  Eigentore).

Both `cd cms && npx tsc --noEmit` and `cd app && npx tsc --noEmit` are
clean.

The real Gruppe screen (member list, role filters, invite-code share) is
still phase 7.

## Status (Phase 6 — Historic data import, per implementation-plan.md §9 — complete)

**`cms/`** — polymorphic player relations + two new collections + a CLI import service:

- **`cms/src/lib/polymorphic.ts`** (new) — every place a player reference
  used to be a plain `users` relationship (`lineups.redPlayers`/
  `greenPlayers`, `matchResults.mvp`/`goals[].player`,
  `playerSeasonStats.player`, `playerCareerStats.player`) is now
  `relationTo: ['users', 'legacyPlayers']` (§3.1). Payload stores/reads a
  polymorphic value as `{relationTo, value}`, not a plain id —
  `polyId()`/`polyKind()`/`polyIds()`/`polyRefs()`/`polyRef()`/
  `polyValue()` centralize that shape so no consumer hand-rolls it. Also
  documents a real MongoDB adapter limitation found by reading
  `node_modules` source: only `equals`/`not_equals` gets rewritten for a
  polymorphic field — a plain-id `in` query against one silently fails to
  match — so every consumer here fetches the bounded set once and
  filters/keys in memory instead (`stats.ts`, `stats-query.ts`,
  `lineup.ts`, `Fixtures.ts`'s endpoints all follow this pattern now).
- **`LegacyPlayers.ts`** (new) — "ghost" profiles for people who appear in
  imported results but never sign up: `group`, `name`, computed
  `initials`, `position`, `note`, `claimedBy`. Read by any group member;
  create/update/delete admin-only at the collection level (the import
  service and the claim endpoint both bypass via `overrideAccess`).
- **`ImportBatches.ts`** (new) — one row per import run: `group`, `kind`,
  `fileName`, `uploadedBy`, `status` (draft/committed/rolled-back),
  `rowCount`, `errorLog`, and a `changeLog` (exactly what was
  created/changed, read back by `rollbackImportBatch()`). Collection API
  is admin-read-only; only the import service writes it.
- **`cms/src/import/`** (new) — the whole historic-data-import service,
  CLI-only per the plan's own recommendation (no `/admin/import` UI):
  - `csv.ts` — a small hand-rolled RFC4180-ish parser (no npm dependency
    added for a one-time-ish tool).
  - `resolve.ts` — builds a name → player index from current members +
    existing `legacyPlayers`; supports a `--aliases=./file.json` escape
    hatch for a name the index can't place (ambiguous, or unresolved)
    since there's no UI to resolve it interactively.
  - `fixtures.ts` (path A), `career-baseline.ts` (path B),
    `legacy-players.ts` (either path) — one module per CSV kind from
    §3.7's table, each dry-run-first, each stamping every write with
    `source: 'import'` + a shared `importBatches` row. `fixtures.ts`'s
    duplicate check flags a likely re-upload (same group+date+hall+both
    scores already recorded). A documented, deliberate gap inherited from
    the CSV spec itself: `fixtures.csv` has no full-roster column, only
    scorers + MVP, so an imported match's `lineups` can only include
    players who scored — and a non-scoring MVP is left off both lineups
    too (no side column to place them on), rather than risk corrupting
    win/loss/goalDiff with a guessed side.
  - `rollback.ts` — `rollbackImportBatch()` undoes exactly one committed
    batch from its `changeLog`: deletes what it created, restores what it
    overwrote (baseline numbers, `memberSince`), and only removes a
    hall/season/legacy player it created if nothing else still references
    it.
  - `cli.ts` — `npm run import:run -- --kind=... --group=<id>
    --file=./x.csv [--dry-run]` (see the file's own header comment for
    full usage). Loads `cms/.env` itself since it runs standalone via
    `tsx`, outside Next's own env loading.
- **`POST /api/legacyPlayers/:id/claim { userId }`** (new, on
  `LegacyPlayers.ts`) — admin/organizer only, and only onto a real member
  of that legacy player's group. Reassigns every polymorphic reference
  (`lib/claim.ts`), merging `baseline*` into the claiming user's
  `playerCareerStats` row (summed, not overwritten) if they already had
  one, and recomputes their stats afterward.
- **`GET /api/players/:id/profile?group=&kind=users|legacyPlayers`** (new
  root-level endpoint, replaces phase 5's `Users.ts`-scoped `/:id/profile`)
  — a profile can now be either kind; `kind` defaults to `users` so the
  existing "Mein Spielerprofil" link needs no change.
- **`cms/src/lib/stats-query.ts`** — `computeGroupPlayerStats` now unions
  current members with the group's `legacyPlayers`, and (all-time scope
  only) adds each player's `playerCareerStats.baseline*` into their totals
  — "all-time total = baseline* + match*", per §3.7.

**`app/`** — `lib/api.ts`'s `ApiRankedRow`/`ApiPodiumEntry`/
`ApiPlayerProfile` all carry a `playerKind`/`kind` now; `getPlayerProfile`
calls the new root endpoint. Statistik's podium/list rows and the "Mein
Spielerprofil" link pass `?kind=` through to `app/spieler/[playerId].tsx`,
which shows a small "EHEMALIG" badge + `note` for a `legacyPlayers`
profile.

Both `cd cms && npx tsc --noEmit` and `cd app && npx tsc --noEmit` are
clean. No historic backfill has actually been run yet for any real group —
that's a CLI invocation someone runs once real spreadsheet(s) are in hand,
not something to script speculatively here.

## Status (Phase 7 — Group management, per implementation-plan.md §9 — complete)

**`cms/`**:

- **`cms/src/lib/strength.ts`** (new) — `recomputeSuggestedStrength()`, the
  §3.3 composite z-score formula, called from `Fixtures.ts`'s
  `/:id/result` handler right alongside `recomputeStatsForPlayers` (this
  codebase has no `matchResults.afterChange` collection hook — that
  endpoint *is* the equivalent recompute point). Reuses
  `computeGroupPlayerStats`'s per-player `matches` list for the
  last-5-weighted `recentForm` input rather than re-deriving a match
  sequence from scratch.
- **`Groups.ts`** gained `GET /:id/members?role=&q=` (role filter + name
  search; `suggestedStrength`/`strengthSampleSize` included only for an
  admin/organizer caller) and `POST /:id/regenerate-code`
  (organizer/admin).
- **`Memberships.ts`** gained `POST /:id/apply-suggested-strength` (sets
  `strength = suggestedStrength`, 400 if there's no suggestion yet) and a
  `beforeChange` hook that blocks a `strength` edit (through the default
  `PATCH /:id`, not just the new endpoint) when `group.features.strength`
  is off — the one flag check that couldn't live in `access.update`
  without also blocking role changes.

**`app/`** — the real Gruppe screen (`(tabs)/gruppe/index.tsx`): invite
code + share, a role filter (Alle/Organisatoren/Spieler — see the in-file
comment for why this reinterprets the prototype's third "Stammspieler"
chip, which meant a games-played cut this screen's member endpoint doesn't
carry), member rows with a role badge and (admin/organizer,
`features.strength` on) a "Vorschlag: Stärke N" hint + one-tap Übernehmen
whenever it differs from the current value, and the existing admin-only
Einstellungen entry point. Tapping a member opens their Spielerprofil.

Two deliberate deviations from §4.5's exact wording, both already
established earlier in this project and just carried forward
consistently:

- **No "Abmelden" on this screen.** §4.5 lists logout here, but that was
  written before the phase-4 addition of a 5th "Profil" tab, which is
  where Abmelden actually lives now — repeating it in two places would be
  redundant.
- ~~Invite code uses the platform share sheet, not a clipboard copy.~~
  **Superseded, see "Since phase 7" below** — the button now does a real
  `expo-clipboard` copy, matching the prototype's actual `onCopy` behavior
  exactly.

Both `cd cms && npx tsc --noEmit` and `cd app && npx tsc --noEmit` are
clean.

---

All 8 phases from implementation-plan.md §9 are now code-complete. What's
left before a real go-live is operational, not architectural: running the
group's actual historic backfill through the phase-6 CLI, and phase 8's
polish pass (toast/animation parity, pull-to-refresh, loading/error
states, push-notification reminders, EAS build + store submission prep) —
still mostly unstarted, except for the slice below.

## Since phase 7: three phase-8 items pulled forward (haptics, clipboard, optimistic updates)

Not a full phase-8 pass — toasts, pull-to-refresh polish, and push
notifications are all still untouched — but three specific items from
§4.1/§4.4 that don't depend on any of that:

- **`expo-haptics`** (§4.1: "light impact on the goal +/- steppers and RSVP
  buttons — cheap and expected on a real device") is wired in on both:
  `components/ui/stepper.tsx`'s shared `Stepper` (covers Ergebnis
  erfassen's per-player and own-goal steppers automatically, since they
  all go through it) and the Start screen's "Bin dabei"/"Kann nicht"
  buttons. Fire-and-forget (`.catch(() => {})`) — haptics are a side
  effect that should never block or fail the actual action, e.g. on a
  simulator with no haptics engine.
- **`expo-clipboard`** replaces the Share-sheet stand-in on the Gruppe
  screen's invite-code button from phase 7. Re-reading the prototype's own
  source closely: its "Teilen" button was never actually a share sheet —
  `onCopy` only ever does `this.setState({ copied: true })` and flashes
  "Code kopiert — ab in die WhatsApp-Gruppe", i.e. it's a plain clipboard
  copy that assumes the recipient pastes the code into WhatsApp
  themselves. `Clipboard.setStringAsync(group.inviteCode)` now matches
  that exactly, with the button label flipping "Teilen" -> "Kopiert" for
  ~2.2s (the same duration as the prototype's own toast-dismiss timer) —
  standing in for a real toast until phase 8 builds one.
- **Optimistic updates** (§4.4's list: "RSVP yes/no, moving a player
  between red/green/pool, the goal +/- steppers, the weekly-repeat
  switch"). Auditing that list against what's actually server-round-trip
  vs. local state: the goal steppers (Ergebnis erfassen accumulates all of
  it in local `useState` until one final "Ergebnis speichern") and the
  weekly-repeat switch (`Neuer Termin`'s `repeatWeekly` toggle, also pure
  local state until submit) were already instant — there was never a
  per-tap network call to make optimistic. The two that *do* hit the
  server on every tap now use react-query's `onMutate`/`onError`/
  `onSuccess` pattern instead of an await-then-invalidate round trip:
  - **RSVP** (`(tabs)/index.tsx`) — `onMutate` writes the new
    `myStatus`/adjusted `yesCount` straight into the
    `['fixture-summary', fixtureId]` cache before the request lands;
    `onError` rolls back to the pre-tap snapshot; `onSuccess` reconciles
    `yesCount` with the server's own count (still authoritative, since
    other members' RSVPs aren't reflected in our own optimistic guess).
  - **Lineup assign/unassign** (Termin-Detail's red/green/pool chips) —
    `onMutate` moves the player between `pool`/`red`/`green` in the
    `['lineup', fixtureId]` cache immediately; `onError` restores the
    prior snapshot; `onSuccess` swaps in the server's own recomputed
    lineup (`PATCH .../lineup` already returns the full `ApiLineup` — no
    separate invalidate+refetch needed). "Zurücksetzen" (clear all) got
    the same optimistic treatment (one immediate cache update merging
    red+green back into the pool, reconciled via `onSettled` once the
    underlying sequential unassigns finish), and "Auto-Aufstellung" now
    writes the server's direct response straight into the cache instead of
    invalidating and re-fetching it a second time.

One environment note worth flagging: this bridge's shell couldn't run
`npx expo install expo-haptics expo-clipboard` (blocked network egress to
the React Native Directory compatibility check, same as documented for
phase 7's clipboard attempt) *or* a plain `npm install` for them (the repo
also has darwin-arm64-only optional binaries like
`@tailwindcss/oxide-darwin-arm64` in its lockfile, which fail an `EBADPLATFORM`
check on this Linux bridge before npm gets to the actual new packages).
Worked around it with `npm pack expo-haptics@57.0.2 expo-clipboard@57.0.2`
(direct registry fetch, sidesteps whole-tree resolution) and manually
extracted both tarballs into `app/node_modules/`, then added both to
`app/package.json`'s `dependencies` by hand (`expo-clipboard` at `~57.0.2`,
matching `expo-haptics`'s existing entry — Expo SDK 57's own modules now
version-track the SDK major). That's enough for `tsc --noEmit` to resolve
their types and for this session's own verification, but
**`app/package-lock.json` was deliberately left untouched** — reconciling
it correctly requires the actual dependency-resolution machinery this
bridge can't run for a project with platform-specific optional deps. Run a
plain `npm install` yourself once, from a real terminal on your Mac, to
let npm regenerate the lockfile properly before your next `npm ci`/CI run;
until then everything works locally off the node_modules already sitting
there, same as after any manual install.

## Since phase 8 (partial): hall management (closes rough edge #7)

A group's halls previously could only ever be created one at a time, on
the fly, from `(tabs)/termine/neu.tsx`'s free-text fallback — no way to
rename one, set a capacity/note after the fact, or remove one. Not called
out in any specific phase (the original prototype hardcoded 3 fixed
halls), but flagged as worth adding "once a group has more than one hall"
both in this doc's own rough-edges list and in implementation-plan.md's
§10 open items.

**`cms/`** — `Halls.ts` gained a `beforeDelete` hook: it looks up any
`fixtures` row still referencing the hall being deleted
(`overrideAccess: true`, `depth: 0`, `limit: 1` — existence check only)
and throws a plain `Error` if one exists, which Payload surfaces to the
REST client as `{errors: [{message: ...}]}` — already parsed by
`lib/api.ts`'s `request()` into `ApiError.message`, the same pattern
`Memberships.ts`'s existing `beforeChange` hook uses. This blocks deletion
server-side rather than silently orphaning a fixture's `hall` reference.

**`app/`** — `lib/api.ts`'s `createHall` now also accepts `capacity`/
`note`, and gained `updateHall(hallId, data)` / `deleteHall(hallId)`. New
screen `(tabs)/gruppe/hallen.tsx` (admin-only, matching Einstellungen's
own admin gate): a list of the group's halls, each tappable into an inline
edit form (name/capacity/note + Löschen), and a "+ Neue Halle" row that
expands into the same form for creating one. Saving/deleting invalidates
both `['halls', groupId]` and any `['fixtures', ...]` query, since fixture
rows embed their hall (depth=1) in Termine/Start/Termin-Detail and a
rename should show up there without waiting for those screens' own
refetch interval. A delete blocked by the `beforeDelete` hook above shows
that hook's German error message as-is. Reachable from a new "Hallen"
section at the bottom of `(tabs)/gruppe/einstellungen.tsx`.

One environment note: this bridge's `node_modules/typescript` turned out
to be v7 (the native/Rust-ish rewrite, not the old pure-JS compiler) and
ships as a small loader plus a platform-specific native binary package
(`@typescript/typescript-<platform>-<arch>`) — only the darwin-arm64 one
was present (matching your actual Mac), so `npx tsc --noEmit` failed
outright on this Linux bridge with "Unable to resolve
@typescript/typescript-linux-arm64" before it could even parse a single
file. Same `npm pack` workaround as phase 8's haptics/clipboard packages:
fetched `@typescript/typescript-linux-arm64@7.0.2`'s tarball directly and
extracted it into `node_modules/@typescript/typescript-linux-arm64` on
this bridge only. This doesn't touch `app/package.json`,
`app/package-lock.json`, or anything under `app/`/`cms/` — it's purely
local scaffolding so this session itself could run `tsc --noEmit`, and
your Mac already has the darwin-arm64 binary it actually needs, so there's
nothing to reconcile there.

Both `cd cms && npx tsc --noEmit` and `cd app && npx tsc --noEmit` are
clean.

## Since phase 8 (partial): admin-panel login lock (not in the original plan)

The Payload admin panel at `/admin` was previously reachable by any real
app user with valid credentials (Payload's own default when a collection
has no explicit `access.admin`). Locked down to a single hardcoded
account, off by default, on request — this only ever gates `/admin`
itself; every app login (`POST /api/users/login`, and everything the
mobile app does) is completely unaffected.

**`cms/`**:

- **`cms/src/lib/admin-access.ts`** (new) — exports
  `ADMIN_PANEL_ALLOWED_EMAIL` (the one account this is scoped to) and
  `isAdminPanelLoginEnabled(payload)`, which reads the new
  `admin-access` global's `enabled` flag via
  `payload.findGlobal({ slug: 'admin-access', overrideAccess: true })` —
  bypassing that global's own `read` access control on purpose, since
  this is being called *from inside* an access-control check elsewhere
  (`Users.ts`), not as a normal authenticated request. **Checked by
  email, not by Mongo `_id`** — the first pass at this hardcoded an
  ObjectId, which immediately locked the intended account out, because
  an ObjectId is only ever valid within the one database it was read
  from: it doesn't survive a fresh `npm run dev` against a new local
  Mongo, a staging DB, or a restored backup. Email is the identity
  that's actually meant to stay stable across all of those, so that's
  what's checked now.
- **`cms/src/globals/AdminAccess.ts`** (new) — a single-field global,
  `enabled` (checkbox, **defaults to `false`**). Two independent gates
  have to both pass before anyone reaches `/admin`: this flag, and
  `Users.ts`'s hardcoded-email check below. Turning this on does *not*
  open the panel to anyone else — it only lifts the kill-switch for the
  one already-hardcoded account. `access.read`/`access.update` on this
  global are themselves restricted to that same account, so no other
  user can even see the toggle exists via the API. Deliberately
  *doesn't* require `enabled: true` to update itself — that would make
  it a one-way switch (once locked, the allowed account could never get
  back into `/admin` to unlock it). Instead that account can always flip
  it with a plain authenticated REST call —
  `POST /api/globals/admin-access { "enabled": true }` using their
  normal app login token — regardless of the panel's current lock
  state, then log into `/admin` once it's back on. Note it's `POST`,
  not `PATCH`: Payload's REST API updates a *global* via `POST`;
  `PATCH` only applies to documents inside a regular collection (this
  tripped up the first live test of this feature — see below).
- **`Users.ts`** gained `access.admin`: returns `false` immediately unless
  `req.user.email === ADMIN_PANEL_ALLOWED_EMAIL`, then defers to
  `isAdminPanelLoginEnabled()`. `access.admin` is the Payload hook that
  specifically gates the `/admin` UI — it has no effect on `read`/
  `create`/`update`/`delete` access or the `auth`-provided
  `POST /api/users/login`/`POST /api/users` endpoints, which is exactly
  why app logins needed no changes here.

Nothing seeds the `admin-access` global's document — Payload returns the
field's `defaultValue` (`false`) until the allowed account's first
`POST` creates it, so the very first admin-panel login for that account
requires one authenticated REST call first (see above), not an admin-UI
click (which would be the chicken-and-egg case this design avoids).

Both `cd cms && npx tsc --noEmit` and `cd app && npx tsc --noEmit` are
clean. Not runnable end-to-end from this bridge itself (no live
Mongo/Payload instance reachable from it — see the rough edges below),
but verified live against your actual running `cms` dev server via the
desktop app's browser pane: confirmed `/admin` refused
`mario@murrent.at` while `enabled` was `false`, flipped the global on
with the authenticated `POST` above, and confirmed `/admin` then loaded
the dashboard for that account. (The first attempt at this used `PATCH`
instead of `POST` and got a genuinely confusing `404 Route not found` —
worth remembering if this ever needs re-verifying.)

## Prerequisites

- Node.js 22+ (Payload 3.88 / Next 16 need a recent Node)
- A MongoDB instance for `cms/` — local (`mongod`) or Atlas both work; set
  `DATABASE_URI` in `cms/.env`
- npm (this repo uses npm workspaces — `pnpm` isn't installable in every
  environment, npm ships with Node and works everywhere)

## Running `app/`

```
cd app
cp .env.example .env   # adjust EXPO_PUBLIC_API_URL if needed
npm start        # then press w/i/a, or scan the QR code with Expo Go
```

## Running `cms/`

```
cd cms
cp .env.example .env   # then fill in DATABASE_URI and a real PAYLOAD_SECRET
npm run dev
```

Visit `http://localhost:3000/admin` to create the first admin user, or just
use the app's own register screen — `POST /api/users` is open to anyone
(§3.4), same as any other signup flow.

## npm workspaces + gluestack-ui: two gotchas worth knowing

If you ever re-run `gluestack-ui init`, `npm install` something into `app/`
directly, or see version drift you don't expect, these two are why:

1. **`overrides` (and yarn's `resolutions`) only take effect from the ROOT
   `package.json`** in an npm workspaces monorepo — one declared inside
   `app/package.json` is silently ignored for anything hoisted to the repo
   root. gluestack's `init` added `lightningcss: 1.30.1` as an override
   inside `app/package.json`; it's been moved to the root `package.json`
   instead, which is what actually pins it (newer lightningcss versions
   fail to parse `global.css` for native bundles — deserialize error on a
   CSS custom property).
2. **A dependency of a workspace member can end up *not* hoisted to the
   root even when nothing conflicts** — `expo` itself stayed nested under
   `app/node_modules/expo` while its own dependency `@expo/metro-config` got
   hoisted to the root, and `@expo/metro-config`'s own internal
   `require.resolve('expo/package.json')` (used to look up the installed
   Expo SDK version) can't see across that boundary — Node module
   resolution only walks *up* from the requiring file, never sideways into
   a sibling workspace's `node_modules`. Fixed by adding `expo` as an
   explicit (matching-version) `devDependency` on the *root*
   `package.json`, which forces it to hoist there too. If you see
   `Cannot find module 'expo/package.json'` again after a fresh install,
   this is almost certainly why — check `ls node_modules/expo` at the repo
   root.

## Known rough edges to sort out yourself

1. **`npx gluestack-ui add <component>` needs a real terminal**, same as
   `init` did — see the note above under `app/`'s status.
2. **`npx payload generate:types` fails on this Node version** with
   `ERR_REQUIRE_ASYNC_MODULE` (a `tsx`/ESM interop issue in Payload's CLI
   loader, not a config problem — `next build` and `next dev`, which don't go
   through that same CLI loader, both work fine). Try it in your own
   environment; if it still fails, pin `tsx`/Node to whatever combination
   Payload's own docs currently recommend, or generate types from a slightly
   older Node LTS.
3. **`className` on raw React Native components doesn't type-check yet.**
   NativeWind v5-preview / `react-native-css` v3 are supposed to add
   `className` (and a few related props) to `View`, `Text`, `ScrollView`,
   etc. via ambient module augmentation (see
   `node_modules/react-native-css/types.d.ts`, pulled in transitively from
   `nativewind-env.d.ts`), but in this exact preview combination that
   augmentation doesn't merge with the `react-native` types our own code
   imports — a real resolution quirk in the current preview packages, not a
   config mistake on our end (confirmed: re-declaring the same props from a
   `.d.ts` *inside* the project does merge correctly, but a naive multi-
   interface version of that patch instead makes TypeScript think
   `react-native` no longer exports `View`/`Text`/etc. at all, which is
   worse — so no local patch is checked in for now). Net effect: `npx tsc
   --noEmit` reports ~10 `Property 'className' does not exist` errors,
   all on `className` usages in our own hand-written screens/primitives.
   This **does not affect the running app** — Metro/Babel strip types
   before bundling, so `expo start` and real builds are unaffected — it
   only affects `tsc --noEmit`'s own signal. Re-check this once nativewind
   v5 leaves preview; if it's still broken, silencing it per-line with
   `// @ts-expect-error nativewind v5-preview className typing` is the
   least invasive workaround.
4. **`expo export --platform web`'s static-rendering step doesn't run in
   this environment.** Metro bundles the web build fine (1400+ modules),
   but the Node-side static-rendering pass
   (`@expo/router-server/node/render.js`) throws inside
   `react-native-web`'s `StyleSheet` interop
   (`TypeError: Cannot read properties of undefined (reading 'default')`)
   — again a nativewind v5-preview/`react-native-css` SSR interop gap, not
   something in our screens (it reproduces before any of our code runs).
   Doesn't block `expo start --web` (client-side rendering, no static
   pre-render step) or native builds; only `expo export --platform web`'s
   static export is affected. Worth re-testing once nativewind v5 is out of
   preview.
5. **Anything that touches a native Node addon has to run in a real
   terminal on your Mac — not the assistant's bridged shell.** That bridge
   is a small *Linux* VM with your project folder mounted into it; it's
   great for `tsc --noEmit`, git, and editing files (all pure JS/text), but
   `node_modules` on disk should always be installed *from your own Mac
   terminal*, because a bunch of this stack's dependencies
   (`lightningcss`, `@tailwindcss/oxide`, `@next/swc`, `sharp`, the Hermes
   compiler, …) ship as prebuilt native binaries picked per-OS/arch at
   install time. Installed correctly (on your Mac), you get
   `*-darwin-arm64` binaries — which is what the app actually needs to run
   — but that also means the Linux bridge VM can no longer bundle or run
   anything past pure type-checking: `expo start`/`export` fails as soon as
   Metro tries to load PostCSS/`lightningcss` (`Cannot find module
   '../lightningcss.linux-arm64-gnu.node'`), and `next dev`/`build` would
   hit the same wall with `@next/swc`. This isn't a bug — it's just two
   different machines. Run `npm install`, `npm start` / `expo start`,
   `expo export`, and `next dev` / `next build` yourself, directly on your
   Mac; ask the assistant to verify types, review/edit code, or work the
   CMS's HTTP API instead of asking it to bundle or run either app.
6. **Both packages' `lint` scripts are currently stale, unrelated to
   anything in this phase.** `cms/package.json`'s `"lint": "next lint"`
   doesn't work on Next.js 16 — that command was removed upstream in favor
   of running ESLint directly, and no ESLint config/dependency was ever
   added here. `app/package.json`'s `"lint": "expo lint"` would work, but
   only after an interactive first run that scaffolds `eslint-config-expo`
   (never done yet). Neither blocks anything today; worth setting up
   properly before relying on `npm run lint` in CI or a pre-commit hook.
7. ~~No hall-management screen exists yet.~~ **Resolved (see "Since phase
   8 (partial): hall management" above)** — `(tabs)/gruppe/hallen.tsx`,
   reachable from Einstellungen. `(tabs)/termine/neu.tsx`'s free-text
   on-the-fly-create fallback is untouched and still works alongside it.
8. **Own goals are not attributed to a specific player.** `matchResults`
   only records `redOwnGoals`/`greenOwnGoals` at the team level, so
   `playerSeasonStats.ownGoals`/`playerCareerStats.matchOwnGoals` are
   always 0 — a deliberate simplification (§3.2/§3.1), not a bug. Revisit
   only if `matchResults.goals` grows an "own goal" entry kind.
9. ~~`memberships.suggestedStrength` (§3.3) is never recomputed.~~
   **Resolved in phase 7** — `cms/src/lib/strength.ts`'s
   `recomputeSuggestedStrength()` now computes it after every result
   save.
