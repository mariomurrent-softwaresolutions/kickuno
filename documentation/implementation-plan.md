# Hallenkick — Implementation Plan

**Expo (React Router) mobile app + PayloadCMS backend + gluestack-ui design system**

Source of truth for design and behavior: `documentation/design_prototype/Fußballgruppen Statistik App/` (the Claude Design canvas prototype: `Fussballgruppe App.dc.html` for markup/logic, `support.js` for the state machine, `ios-frame.jsx` for the device-frame chrome only — that file is *not* part of the real app).

Decisions locked in for this plan: **MongoDB** as the Payload database, a **monorepo** with one `app/` folder (Expo) and one `cms/` folder (Payload) at the repo root, and **real authentication** (email + password) from day one, on top of the prototype's group-invite-code flow.

---

## 1. What the prototype actually is

Reading `Fussballgruppe App.dc.html` and its `support.js` state class end to end, the app ("Hallenkick") is a single-group companion app for a recurring indoor five-a-side/futsal game ("Rot gegen Grün" — Red vs Green), Thursdays 20:00. Nine screens, one bottom tab bar, dark theme only:

| Screen | Purpose |
|---|---|
| Login | Enter group invite code + name |
| Start (tab) | Next fixture card w/ RSVP + countdown + attendance bar, my season tiles, my last-5 form, last game score, top-3 scorers |
| Termine (tab) | Upcoming + past fixtures list, "create fixture" entry point |
| Termin-Detail | Per-fixture team builder: Zusagen/Eingeteilt/Balance stat row, auto-balance & clear, Red/Green team pools (tap a chip to unassign), unassigned pool (tap Rot/Grün to assign), CTA into result entry |
| Ergebnis erfassen | Big score display, per-player goal steppers for both teams, own-goals counters, MVP chip picker, save |
| Statistik (tab) | Season/All-Time segmented toggle, 8 scrollable metric chips, 3-player podium, ranked list with a value + inline percentage bar |
| Spielerprofil | Avatar/name/position/strength, last-5 form, season stat grid, all-time stat list |
| Neuer Termin | Pick date (next 6 Thursdays), time, hall, weekly-repeat toggle, create |
| Gruppe (tab) | Invite code + copy/share, role filters, member list with role badges, logout |

Core domain entities implied by the state (`support.js`): **Player** (name, initials, position, strength 1–5, member-since year, last-5 form, season stats, all-time stats), **Fixture/"Termin"** (date, time, hall, RSVP count, played flag, score), **Lineup** (red/green player id arrays per fixture), **Match result** (score, per-player goals, own goals per side, MVP), **Group** (invite code, halls, members, roles: Admin / Organisator / Spieler).

Visual language to reproduce exactly:

- Palette: app bg `#07090A`, screen bg `#0B0E0F`, card `#14181A`, sunken row `#101416`, hairline borders `rgba(255,255,255,.07)`, red `#E23B3B`, green `#2FBF6E`, gold `#F4D35E`, ink text `#F2F5F4`, muted text `#6E7A76` / `#8A9490`, dim nav `#4E5754`.
- Type: **Barlow Condensed** (700, uppercase, tight leading) for headlines/scores/stat numbers; **Barlow** (400–700) for everything else.
- Shapes: 26px radius grouped cards/lists, 14–20px radius on tiles/buttons, full-pill chips and toggles, 1px hairline separators, no shadows except the login gradient background.
- Motion: a single `popin` toast (translateY 6px → 0, fade in) used for every confirmation message ("Zusage gespeichert", "Teams nach Stärke ausbalanciert", "Ergebnis 4:3 gespeichert — Statistik aktualisiert", …).

---

## 2. Monorepo layout

```
kickuno/
├─ app/                     Expo app (Expo Router, TypeScript, gluestack-ui)
├─ cms/                     PayloadCMS backend (TypeScript, MongoDB)
├─ documentation/           (existing) prototype + this plan
├─ package.json             pnpm workspace root
├─ pnpm-workspace.yaml
└─ .github/workflows/       CI (lint/typecheck/test for both packages)
```

`pnpm-workspace.yaml`:

```yaml
packages:
  - app
  - cms
```

Payload auto-generates TypeScript types for every collection (`cms/payload-types.ts`). Rather than a third `packages/shared`, `app/` imports its API types from a thin `app/lib/api-types.ts` that re-exports the pieces it needs from a copy (or a small build step that copies `cms/payload-types.ts` into `app/lib/`) — keeps the two-folder structure the user asked for while still sharing types. A `packages/shared` package is worth introducing later only if a third consumer (e.g. an admin web app) appears.

---

## 3. Backend — `cms/` (PayloadCMS on MongoDB)

### 3.1 Collections

```
groups
  name            text
  inviteCode      text, unique, auto-generated (e.g. "HALLE-OST"), regenerable via custom endpoint
  createdBy       relationship -> users
  features        group field, admin-only to edit (§3.8):
                    rsvp          checkbox, default true
                    autoBalance   checkbox, default true
                    strength      checkbox, default true

halls
  group           relationship -> groups
  name            text                     "Halle Ost"
  capacity        number                   16
  note            text                     "Standard · 16 Plätze"

users  (Payload auth collection)
  email           (auth)
  password        (auth)
  name            text
  initials        text, read-only, computed beforeChange hook from `name`
  position        select: tor | abwehr | mitte | sturm
  memberSince     date, default now
  avatarSeed      text (optional, for consistent avatar gradient)

memberships                      (join table: supports multi-group even though v1 is single-group per user)
  user                relationship -> users
  group               relationship -> groups
  role                select: admin | organizer | player
  strength            number 1–5, default 3, admin/organizer-editable
  suggestedStrength    number 1–5, nullable, read-only — computed, field-level read restricted to admin/organizer (see §3.3)
  strengthSampleSize   number, read-only — games played the suggestion is based on
  strengthSuggestedAt  date, read-only
  joinedAt            date, default now
  unique index on (user, group)

seasons
  group           relationship -> groups
  label           text            "25/26"
  startDate       date
  endDate         date
  isCurrent       checkbox

fixtures                          ("Termine")
  group           relationship -> groups
  season          relationship -> seasons
  date            date
  time            text            "20:00"
  hall            relationship -> halls
  status          select: upcoming | played
  repeatGroupId   text, optional  (tags the 8 fixtures created by "wöchentlich wiederholen")
  createdBy       relationship -> users

rsvps
  fixture         relationship -> fixtures
  user            relationship -> users
  status          select: yes | no
  respondedAt     date
  unique index on (fixture, user)

lineups                           (one per fixture)
  fixture         relationship -> fixtures, unique
  redPlayers      relationship (has many) -> [users, legacyPlayers], polymorphic
  greenPlayers    relationship (has many) -> [users, legacyPlayers], polymorphic
  updatedAt       date

matchResults                      (one per fixture)
  fixture         relationship -> fixtures, unique
  redScore        number
  greenScore      number
  redOwnGoals     number, default 0
  greenOwnGoals   number, default 0
  mvp             relationship -> [users, legacyPlayers], polymorphic
  goals           array: { player: relationship -> [users, legacyPlayers], team: select red|green, count: number }
  recordedBy      relationship -> users
  recordedAt      date
  source          select: live | import, default live
  importBatch     relationship -> importBatches, optional (set when source = import)

playerSeasonStats                 (aggregation cache — rebuilt by hook, never hand-edited)
  player, season  relationships (player is polymorphic -> [users, legacyPlayers]), unique compound index
  played, wins, draws, losses, goals, ownGoals, mvps, goalDiff   numbers

playerCareerStats                 (aggregation cache, one row per player per group)
  player, group   relationships (player is polymorphic -> [users, legacyPlayers]), unique compound index
  yearsActive     number
  matchPlayed, matchWins, matchDraws, matchLosses,
  matchGoals, matchOwnGoals, matchMvps, matchGoalDiff        numbers — computed from recorded matchResults only
  baselinePlayed, baselineWins, baselineDraws, baselineLosses,
  baselineGoals, baselineOwnGoals, baselineMvps, baselineGoalDiff   numbers, default 0 — manually seeded via career-baseline import (§3.7), never touched by the stats-recompute hook
  (all-time totals shown in the app = baseline* + match* — see §3.7)

legacyPlayers                     (historic "ghost" profiles for people who appear in imported results but never sign up)
  group           relationship -> groups
  name            text
  initials        text, computed same as users
  position        select: tor | abwehr | mitte | sturm, optional
  note            text, optional            "gespielt 2018–2021"
  claimedBy       relationship -> users, optional — set once an admin merges this into a real account (§3.7)

importBatches                     (audit trail for every import run)
  group           relationship -> groups
  kind            select: fixtures | career-baseline | legacy-players
  fileName        text
  uploadedBy      relationship -> users
  status          select: draft | committed | rolled-back
  rowCount        number
  errorLog        json, optional
  createdAt       date
```

### 3.2 Hooks & derived logic

- **`users.beforeChange`** — recompute `initials` from `name` (first letter of first + last token, uppercased — same as `initials()` in `support.js`).
- **`groups.beforeChange`** (create) — generate a unique, human-friendly invite code if none supplied.
- **`fixtures` custom endpoint `POST /fixtures/weekly`** — given a base fixture payload + `repeat: true`, creates that fixture plus the next 7 weekly occurrences in one transaction, all tagged with a shared `repeatGroupId`. Mirrors the "Wöchentlich wiederholen… legt die nächsten 8 Donnerstage an" toggle.
- **`lineups` custom endpoint `POST /fixtures/:id/auto-balance`** — server-side port of `autoTeams()`: take everyone with `rsvp.status = yes`, sort by `strength` desc then season `goals` desc, snake-distribute (index `i % 4 === 0 || i % 4 === 3` → red, else → green) so both sides end up close in average strength. Persists to `lineups`.
- **`matchResults.afterChange`** — on create/update, recompute (not increment — full recompute per affected season/career row, in a transaction) `playerSeasonStats` and `playerCareerStats` for every player in `lineup.redPlayers ∪ lineup.greenPlayers`: played, wins/draws/losses (from which side won), goals (sum of that player's `goals[].count`), ownGoals, mvps (`mvp === player`), goalDiff (team score differential while that player was on the pitch, summed). Recompute-from-scratch is intentionally chosen over incremental deltas so that editing a past result (fixing a wrong score) can never leave stats inconsistent. The same hook then recomputes `suggestedStrength` for the whole group's roster — see §3.3.
- **`rsvps`** — upsert semantics: one call flips a user's own yes/no for a fixture (unique index enforces one row per user+fixture).

### 3.3 Computed strength suggestion

`strength` stays admin/organizer-editable exactly as decided — it's the number auto-balance actually uses. Alongside it, `memberships.suggestedStrength` is a **read-only, data-derived nudge** the admin can glance at and choose to apply; it never overwrites `strength` on its own; auto-balance never reads it directly.

**Why relative to the group, not an absolute scale**: strength only ever matters for splitting *this* group's roster into two even teams, so the suggestion ranks each member against their own group's current season rather than against some fixed 1–5 rubric — a group of mostly-casual players and a group of ex-club players should each still spread across the full 1–5 range.

**Inputs** (from that member's current-season `playerSeasonStats`, i.e. the same row §3.2 already recomputes):

- `winRate = wins / played`
- `goalDiffPerGame = goalDiff / played` — a plus/minus proxy that rewards defenders and keepers as much as scorers, since it reflects team result while that player was on the pitch, not just their own goals
- `goalsPerGame = goals / played`
- `recentForm` — last 5 results weighted `[5,4,3,2,1]` (most recent heaviest), each result scored S=1 / U=0.5 / N=0, normalized to 0–1

**Eligibility**: a membership needs `played >= 5` in the current season before it gets a suggestion at all — `suggestedStrength = null` and `strengthSampleSize` shows the count until then, so a brand-new player isn't auto-labeled weak or strong off one or two games.

**Composite score**, computed once per group every time a result is saved, over all eligible memberships in that group:

```ts
// per eligible membership, each input z-scored against the *group's* eligible pool
const composite =
  0.45 * zscore(winRate) +
  0.30 * zscore(goalDiffPerGame) +
  0.15 * zscore(goalsPerGame) +
  0.10 * zscore(recentForm);

const suggestedStrength =
  composite <= -1.25 ? 1 :
  composite <=  -0.4 ? 2 :
  composite <    0.4 ? 3 :
  composite <   1.25 ? 4 : 5;
```

`goalDiffPerGame` carries the heaviest single-metric weight after win rate deliberately, so the suggestion doesn't just become a proxy for "top scorer" — a solid defensive player on a winning side should still trend upward. Position-weighting the composite (e.g. discount raw goals for `abwehr`/`tor` players even further) is a reasonable v2 refinement, not needed for launch.

**Applying it**: the Gruppe screen's member list (admin/organizer view only) shows current `strength` next to `suggestedStrength` whenever they differ, with an "Übernehmen" action per row — see §3.6 for the endpoint. `suggestedStrength` and `strengthSampleSize` are field-level restricted to admin/organizer in Payload's access config so regular players never see teammates' computed ratings.

### 3.4 Access control

Every collection's access functions resolve the requesting user's `memberships` for the relevant `group` and gate accordingly:

- Any authenticated member of the group: read fixtures/lineups/results/stats/halls/members, RSVP, edit their own `position`, read/update their own profile. `strength` and `suggestedStrength` are read-only to a regular player, even on their own membership — self-reported strength would let a player game auto-balance.
- `organizer` or `admin` only: create/edit fixtures, halls, seasons; edit lineups; create/edit match results; regenerate invite code; change another member's role; edit any member's `strength` and apply `suggestedStrength` (§3.3).
- `admin` only: remove members, delete the group; run historic-data imports and claim legacy players (§3.7); edit `groups.features` (§3.8).

### 3.5 Auth & onboarding flow (real auth + group code)

Payload's built-in email/password auth strategy on `users`, JWT in an httpOnly-equivalent (mobile: returned token stored in `expo-secure-store`). Onboarding is two steps that read as one screen in the app (mirroring the prototype's single Login screen, with a mode switch):

1. **Create account / Log in** — email + password (+ name, on sign-up).
2. **Join a group** — invite code, resolved server-side (`POST /groups/join { code }`) to create a `memberships` row with `role: player` and seed zero-value `playerSeasonStats`/`playerCareerStats` rows for the current season. A brand-new group's creator instead hits `POST /groups` and is auto-made `admin`.

If a user already has exactly one membership, step 2 is skipped on subsequent logins and they land straight in the tab shell.

### 3.6 Key API surface

| Method & path | Purpose |
|---|---|
| `POST /api/users/login` / `/logout` / `/refresh-token` | Payload auth (built-in) |
| `POST /api/groups` | create a group (becomes admin) |
| `POST /api/groups/join` | join by invite code |
| `PATCH /api/groups/:id` | Payload's default collection endpoint — covers editing `name` and `features` (§3.8), admin-only |
| `GET /api/groups/:id/members?role=&q=` | member list w/ role filter (Gruppe screen); includes `strength` for everyone, `suggestedStrength`/`strengthSampleSize` only in the admin/organizer response |
| `PATCH /api/memberships/:id` | organizer/admin: set a member's `strength` manually — 403 if `group.features.strength` is off |
| `POST /api/memberships/:id/apply-suggested-strength` | organizer/admin: set `strength = suggestedStrength` (400 if still `null`) — 403 if `group.features.strength` is off |
| `POST /api/groups/:id/regenerate-code` | organizer/admin only |
| `GET /api/fixtures?group=&status=upcoming\|played` | Termine list |
| `POST /api/fixtures` | create one fixture |
| `POST /api/fixtures/weekly` | create fixture + 7 weekly repeats |
| `GET /api/fixtures/:id` | fixture detail (joins hall, rsvp count) |
| `POST /api/fixtures/:id/rsvp` | set my yes/no — 403 if `group.features.rsvp` is off (§3.8) |
| `GET /api/fixtures/:id/lineup` | red/green/pool — pool is "confirmed, unassigned" when RSVP is on, "everyone, unassigned" when it's off |
| `PATCH /api/fixtures/:id/lineup` | manual assign/unassign (move a player between red/green/pool) — always available regardless of flags |
| `POST /api/fixtures/:id/auto-balance` | server-computed balanced split — 403 if `group.features.autoBalance` is off; sort key drops to goals-only when `group.features.strength` is off (§3.8, §5) |
| `POST /api/fixtures/:id/result` | save score, goals[], own goals, MVP → triggers stats recompute |
| `GET /api/stats?group=&scope=season\|alltime&metric=` | ranked rows + podium for one metric |
| `GET /api/users/:id/profile?group=` | Spielerprofil data (form, season grid, all-time list) |

### 3.7 Historic data import

Groups switching to this app already have years of history (`support.js`'s own seed data assumes members joined as far back as 2016), and none of it exists as real `fixtures`/`matchResults` rows yet. Two realistic starting points, and the import tooling supports both:

**A. Match-by-match history exists** (someone kept a spreadsheet of every night's score and scorers) — the strongly preferred path, because importing at this granularity creates real `fixtures` + `lineups` + `matchResults` rows that flow through the *exact same* `matchResults.afterChange` hook as a live-recorded result (§3.2). `playerSeasonStats` and `playerCareerStats.match*` fall out correctly with zero special-case logic — season toggles, streaks, podiums all just work for imported nights too.

**B. Only lifetime totals exist** ("Markus: 214 Spiele, 142 Siege, 310 Tore…", no per-match detail) — handled by seeding `playerCareerStats.baseline*` fields directly (§3.1). The app displays `baseline* + match*` as the all-time total, so a group can import a rough lifetime baseline today and still get fully accurate match-level all-time stats for everything played from this point on, without the two ever conflicting. Baseline import does **not** touch `playerSeasonStats` (there's no meaningful "season" for a lump-sum legacy total) — season stats and streaks simply start from zero at go-live, which is the honest answer when no dated history exists.

Both paths are CSV/XLSX uploads, resolved and previewed before anything is written:

| CSV | Columns | Writes |
|---|---|---|
| `fixtures.csv` (path A) | `date, time, hall, season, redScore, greenScore, redOwnGoals, greenOwnGoals, mvp, redGoals, greenGoals` — `redGoals`/`greenGoals` are `Name:count;Name:count` pairs | one `fixtures` (`status: played`) + `lineups` + `matchResults` row per CSV row |
| `career-baseline.csv` (path B) | `name, played, wins, draws, losses, goals, ownGoals, mvps, goalDiff, memberSince` | one `playerCareerStats.baseline*` row per CSV row |
| `legacy-players.csv` (either path, for people no longer in the group) | `name, position, note` | one `legacyPlayers` row per CSV row |

**Player name resolution** is the one genuinely fiddly part: every name in a CSV has to resolve to an existing `users` row (current member), an existing `legacyPlayers` row, or a brand-new `legacyPlayers` row for someone who's since left. The import flow is therefore always **dry-run first**: parse and validate server-side, return a preview with every row's resolved/unresolved names, let the admin manually map any ambiguous ones (or confirm "create as legacy player"), then **commit** as a separate step that actually writes — stamping every created document with `source: import` and a shared `importBatches` row so a bad import can be identified and reverted (delete everything sharing that `importBatch` id) without touching anything recorded live. Commit also runs a light duplicate check on path A (same group + date + hall + both scores already present → flagged, not silently re-created) since re-uploading the same file by accident is the likeliest failure mode.

**Where it lives**: a small `cms/src/import/` service (parse → validate → preview → commit, one function per CSV kind) used two ways —

- a **CLI script** (`pnpm --filter cms import:run --kind=fixtures --file=./history.csv --group=<id> [--dry-run]`) for the one-time historic backfill, which is the realistic first use and doesn't need any UI work;
- a minimal **custom Payload admin view** (`/admin/import`) wrapping the same service with a file-upload + preview-table UI, worth adding once the group expects to keep receiving the occasional "found an old spreadsheet" top-up rather than a single one-time load. (Exact registration API for a custom admin view — `admin.components.views` in current Payload — should be checked against whatever Payload version is pinned at build time.)

**Claiming a legacy player**: if someone from `legacyPlayers` rejoins and creates a real account, `POST /api/legacy-players/:id/claim { userId }` (admin/organizer only) reassigns every polymorphic reference (`matchResults.goals[].player`, `matchResults.mvp`, `lineups.redPlayers/greenPlayers`, `playerSeasonStats.player`, `playerCareerStats.player`) from the `legacyPlayers` id to the `users` id in one transaction, sets `legacyPlayers.claimedBy`, and folds any `baseline*` numbers into that player's `playerCareerStats` row — so their entire history (imported and live) shows up under their real account with no gaps.

### 3.8 Group feature flags

Three named, boolean toggles on `groups.features` — plain fixed fields rather than a generic flags collection, since there are only a handful and each one gates specific, well-understood behavior rather than being an experiment to run and retire. Editing them is just Payload's default `PATCH /api/groups/:id`, restricted to `admin`; if the list grows well past a handful later, revisiting this as its own `featureFlags` collection (one row per group per key, with a change log) becomes worth it — not needed for three.

Turning a flag off is a real behavior change, not just a hidden button, and it's enforced server-side so a stale or tampered client can never do the disabled thing:

| Flag | When off |
|---|---|
| `rsvp` | No per-person yes/no is collected. `POST /fixtures/:id/rsvp` returns 403. A fixture's "confirmed pool" (the set of players eligible for team assignment) becomes *every active member of the group* instead of "everyone who said yes." The Start screen's next-fixture card drops the Bin dabei / Kann nicht buttons and the attendance bar; Termine list rows drop the Zusagen count. |
| `autoBalance` | The "Auto-Aufstellung" button disappears from Termin-Detail and `POST /fixtures/:id/auto-balance` returns 403. Teams can still be built entirely by manual assign/unassign (unaffected by this flag). |
| `strength` | No `Stärke` number anywhere — profile header, pool rows, lineup chips all drop it — and `PATCH /memberships/:id` / `apply-suggested-strength` both 403; the §3.3 suggestion recompute is skipped entirely for that group (no wasted work). The "Balance" stat card on Termin-Detail disappears too, since it's defined as a strength-sum difference and has nothing to show without it. If `autoBalance` is still on, its sort key falls back from `strength desc, then goals desc` to `goals desc` alone — see §5. |

None of the three affects Statistik or Ergebnis erfassen — goals, wins, MVP, and own goals are tracked regardless, so the leaderboard stays fully populated even in a group running with RSVP, auto-balance, and strength all switched off.

---

## 4. Mobile app — `app/` (Expo + Expo Router + gluestack-ui)

### 4.1 Stack

- **Expo** (managed workflow, latest SDK), **TypeScript**, **Expo Router** (file-based navigation).
- **gluestack-ui v2** + **NativeWind v4** (Tailwind for React Native) as the styling engine gluestack-ui is built on.
- **@tanstack/react-query** for all server state (fixtures, stats, profile, members) with focus-refetch; a thin `AuthContext` (React context + `expo-secure-store`) for the JWT/current user/current membership.
- **react-hook-form + zod** for the login/join, create-fixture, and result forms.
- **@expo-google-fonts/barlow** + **@expo-google-fonts/barlow-condensed**, loaded via `expo-font` + `expo-splash-screen` gating.
- **react-native-svg** for every icon — the tab bar glyphs, chevrons, back arrow, etc. are simple inline SVG paths already fully specified in the prototype markup and can be copied path-for-path.
- **expo-haptics** (light impact) on the goal +/- steppers and RSVP buttons — small parity touch, not in the original but cheap and expected on a real device.
- Phase 2: **expo-notifications** for "new fixture created" / "fixture tomorrow, you haven't responded" pushes, triggered from a Payload webhook or scheduled job.

### 4.2 gluestack-ui theming — matching the prototype exactly

Configure `gluestack-ui.config.ts` / `tailwind.config.js` tokens once, then never hand-roll colors again:

```ts
colors: {
  bgApp:   '#07090A',   bgScreen: '#0B0E0F',  bgCard: '#14181A',  bgSunken: '#101416',
  hairline:'rgba(255,255,255,0.07)',
  red:     '#E23B3B',   green:    '#2FBF6E',  gold:   '#F4D35E',
  ink:     '#F2F5F4',   muted:    '#6E7A76',  mutedSoft: '#8A9490', dim: '#4E5754',
},
radii: { sm: 11, md: 14, lg: 18, xl: 20, xxl: 26, pill: 9999 },
fonts: {
  heading: 'BarlowCondensed_700Bold',   // scores, big titles, stat numbers
  body:    'Barlow_500Medium',          // labels, body copy
  bodyBold:'Barlow_700Bold',            // buttons, emphasis
},
```

Force `colorMode: 'dark'` unconditionally in `GluestackUIProvider` — the prototype has no light mode and shouldn't grow one just because the framework supports it.

Component mapping — gluestack primitives cover the generic cases; the bespoke pieces get small wrapper components in `app/components/ui/` built out of `Box`/`HStack`/`VStack`/`Text`/`Pressable`:

| Prototype element | Approach |
|---|---|
| Buttons (solid gradient, outline, ghost) | gluestack `Button` variants, custom gradient variant for the primary red→green CTA (login, nothing else uses it) |
| Inputs (code/name/email/password) | gluestack `Input` |
| Grouped stat tiles (4-up grid) | custom `StatTile` |
| Last-5 form pills (S/U/N) | custom `FormResultPill` |
| Player chip (pill w/ avatar + name + strength, red/green tinted) | custom `PlayerChip` |
| Fixture row (date block + details + zusagen count) | custom `FixtureRow` |
| Segmented control (Saison/All-Time) | custom `SegmentedControl` (gluestack `Tabs` doesn't quite match the pill-toggle look) |
| Scrollable metric chip row | gluestack `Pressable` + `Badge`-style chip, in a horizontal `ScrollView` |
| Podium (3 bars, gold/silver/bronze rings) | custom `Podium` |
| Ranked list row w/ inline % bar | custom `RankRow` (absolute-positioned fill bar behind content, same trick as the prototype) |
| Goal stepper (– value +) | custom `Stepper` |
| MVP chip picker | reuse `PlayerChip`'s chip variant |
| Toggle (weekly repeat) | gluestack `Switch`, restyled to the pill/knob look |
| Toast ("Zusage gespeichert" etc.) | gluestack `Toast`, or a minimal custom `AppToast` if gluestack's timing/placement doesn't match the bottom-anchored `popin` exactly |
| Bottom tab bar | fully custom (Expo Router `Tabs` with `tabBar` render prop) — the icons and active-color logic are simple enough that gluestack's own navigation add-ons aren't needed |

### 4.3 Navigation — Expo Router file tree

```
app/
  _layout.tsx                    fonts + splash gate, GluestackUIProvider (dark), QueryClientProvider, AuthProvider
  (auth)/
    _layout.tsx                  Stack; redirects into (app) once authenticated + group-joined
    login.tsx                    email + password
    register.tsx                 create account
    join.tsx                     enter invite code / create a group
  (app)/
    _layout.tsx                  guards: redirect to (auth) if no session or no membership
    (tabs)/
      _layout.tsx                custom tab bar: Start · Termine · Statistik · Gruppe
      index.tsx                  Start
      termine/
        _layout.tsx               Stack (its own header/back, like the prototype's per-tab history)
        index.tsx                 Termine list
        neu.tsx                   Neuer Termin
        [fixtureId]/
          index.tsx                Termin-Detail (team builder)
          ergebnis.tsx             Ergebnis erfassen
      statistik/
        _layout.tsx
        index.tsx                 Statistik
      gruppe/
        _layout.tsx
        index.tsx                 Gruppe
    spieler/
      [playerId].tsx              Spielerprofil — outside the tab groups so it can be pushed from Start, Statistik, Termin-Detail, or Gruppe and back() always returns to the tab it was opened from, exactly like the prototype's shared `history` stack. `playerId` may resolve to a `users` or a `legacyPlayers` record (§3.7); a legacy profile renders the same layout read-only, minus anything account-specific (no edit affordances, no RSVP history)
```

This replaces the prototype's hand-rolled `screen` state + `history` array with Expo Router's native stack per tab — `back()` and per-screen headers (title/back button/avatar) come for free from `Stack.Screen` options instead of being computed in a `head()` function.

### 4.4 Data flow

- Query keys: `['fixtures', groupId, status]`, `['fixture', fixtureId]`, `['lineup', fixtureId]`, `['stats', groupId, scope, metric]`, `['profile', userId, groupId]`, `['members', groupId, roleFilter]`.
- Mutations use optimistic updates for anything that felt instant in the prototype: RSVP yes/no, moving a player between red/green/pool, the goal +/- steppers, the weekly-repeat switch — matching the "no spinner, just updates" feel of the original `setState` calls.
- Every mutation's `onSuccess` fires the matching toast copy 1:1 from the prototype ("Zusage gespeichert", "Absage gespeichert", "Teams nach Stärke ausbalanciert", "Termin angelegt — Gruppe wurde benachrichtigt", "Code kopiert — ab in die WhatsApp-Gruppe", "Ergebnis {r}:{g} gespeichert — Statistik aktualisiert").

### 4.5 Screen build notes

| Screen | Behaviors to reproduce | Data needed |
|---|---|---|
| Login/Register/Join | code+password auth, invite-code join, gradient bg, red/green logo mark | `POST /users/login`, `/users`, `/groups/join` |
| Start | next-fixture card (countdown, attendance bar, Bin dabei/Kann nicht/chevron), 4 season tiles, last-5 form strip, last game score card, top-3 scorer list | `GET /fixtures?status=upcoming` (first), `/fixtures?status=played` (first), `/stats?scope=season&metric=tore` (top 3), `/profile/:me` |
| Termine | upcoming + past sections, "+ Neuen Termin anlegen" dashed CTA | `GET /fixtures` split client-side or two calls |
| Termin-Detail | 3 stat cards, auto-balance/clear buttons, red pool / green pool (tap chip → unassign), unassigned pool (Rot/Grün buttons), CTA text switches "erfassen" vs "bearbeiten" | `GET /fixtures/:id`, `/fixtures/:id/lineup`, `POST .../auto-balance`, `PATCH .../lineup` |
| Ergebnis erfassen | big score readout (derived from steppers + own goals), per-player steppers both sides, own-goal counters both sides, MVP chip row, save | `GET lineup`, `POST /fixtures/:id/result` |
| Statistik | Saison/All-Time segmented control, 8 metric chips (Tore/Siegquote/Siege/Teilnahmen/Torverhältnis/Serie/MVP/Eigentore), podium (2nd-1st-3rd order, gold/silver/bronze), ranked rows w/ % fill bar | `GET /stats?scope=&metric=` |
| Spielerprofil | header card, last-5 form, season stat grid (6 tiles), all-time list (6 rows) | `GET /users/:id/profile?group=` |
| Neuer Termin | next-6-Thursdays date picker, time chips, hall radio list, weekly-repeat switch | `POST /fixtures` or `/fixtures/weekly` |
| Gruppe | invite code + copy/share, role filter chips (Alle/Organisatoren/Stammspieler), member list w/ role badge, logout; **for admin/organizer**, each row also shows `strength` with a "Vorschlag: {suggestedStrength}" hint + Übernehmen button whenever it differs and enough games exist (hidden entirely if `strength` is off); an **Einstellungen** entry point (admin-only) opens the feature-flags screen | `GET /groups/:id/members`, `POST /groups/:id/regenerate-code`, `PATCH /memberships/:id`, `POST /memberships/:id/apply-suggested-strength` |

### 4.6 Feature flags in the app

`group.features` comes back as part of the same group/membership payload the app already loads right after login, cached alongside the rest of group context and exposed through a `useFeatures()` hook — every screen below reads it from there rather than re-fetching.

**Settings screen** — `gruppe/einstellungen.tsx`, an admin-only entry point off the Gruppe screen: three rows, each an on/off `Switch` in the same pill/knob visual as the prototype's "Wöchentlich wiederholen" toggle, PATCHing `groups/:id` on change with an instant optimistic flip (consistent with how every other toggle in the app behaves) and the usual toast on save.

**Per-screen effect of each flag being off** (also covered per-flag in §3.8):

| Screen | `rsvp` off | `autoBalance` off | `strength` off |
|---|---|---|---|
| Start | Next-fixture card loses the Bin dabei/Kann nicht buttons and the attendance bar; still shows date, time, location, countdown, and a plain "Zum Termin" chevron | — | — |
| Termine | Rows lose the Zusagen count | — | — |
| Termin-Detail | Pool = every active member instead of confirmed-only; "Zusagen" stat card reads as member count | "Auto-Aufstellung" button hidden | "Balance" stat card hidden; no `Stärke` label on any chip/pool row |
| Gruppe | — | — | Admin strength column + suggestion/Übernehmen UI hidden entirely |
| Spielerprofil | — | — | `Stärke` dropped from the header subtitle |
| Statistik, Ergebnis erfassen, Neuer Termin | unaffected | unaffected | unaffected |

---

## 5. Auto-balance algorithm (server port)

Directly from `support.js`'s `autoTeams()`:

```ts
// `strength` here is each player's *membership* strength for this group (§3.1/§3.3),
// the admin-set number — never `suggestedStrength` directly.
function autoBalance(confirmed: MemberWithStats[], strengthEnabled: boolean): { red: string[]; green: string[] } {
  const sorted = [...confirmed].sort(strengthEnabled
    ? (a, b) => b.strength - a.strength || b.seasonGoals - a.seasonGoals
    // §3.8: with the `strength` feature off, there's no rating to sort by —
    // fall back to the best available proxy, season goals alone.
    : (a, b) => b.seasonGoals - a.seasonGoals
  );
  const red: string[] = [], green: string[] = [];
  sorted.forEach((p, i) => {
    (i % 4 === 0 || i % 4 === 3 ? red : green).push(p.id);
  });
  return { red, green };
}
```

Run this inside `POST /fixtures/:id/auto-balance` (itself 403 when `group.features.autoBalance` is off), persisted to `lineups`. The "Balance" figure shown in the UI is `sum(strength on red) − sum(strength on green)`, colored green when `|balance| <= 1`, gold otherwise — reproduce that exact formula and threshold client-side from the lineup response; the card that shows it is hidden altogether when `group.features.strength` is off, since there's nothing meaningful to compute it from.

## 6. Statistics computation parity

Eight metrics, each with a `get(player)` and a `sub(player)` (secondary line) — implement once, server-side, shared by season and all-time scope:

| Metric key | Value | Secondary line |
|---|---|---|
| `tore` (Tore) | goals | "{played} Spiele" |
| `quote` (Siegquote) | round(wins / played × 100) + "%" | "{wins} Siege" |
| `siege` (Siege) | wins | "{wins}S · {draws}U · {losses}N" (season) / "{played} Spiele" (all-time) |
| `teilnahmen` (Teilnahmen) | played | "{round(played/18×100)}% der Termine" (season) / "seit {memberSince}" (all-time) |
| `diff` (Torverhältnis) | goalDiff, signed | "als Teamspieler" |
| `streak` (Serie) | current win streak length (0 if last result wasn't a win) | last-5 form string |
| `mvp` (MVP) | mvp count | "Auszeichnungen" |
| `eigen` (Eigentore) | own goals | "Hall of Shame" |

`GET /stats` returns, for the requested `(scope, metric)`: the full ranked list (rank, value formatted, `sub`, and `pct = round(value / maxValue × 100)` for the inline bar) plus a `podium` of the top 3 reordered `[2nd, 1st, 3rd]` with ring colors gold/silver/bronze and bar heights 92/70/56px, matching the prototype exactly.

---

## 7. Assets

- Fonts: `@expo-google-fonts/barlow` (400/500/600/700 + 600 italic) and `@expo-google-fonts/barlow-condensed` (500/600/700).
- App icon / splash: the two-tone red/green rounded-square mark from the login screen.
- No other imagery — the entire prototype is typography, color, and vector icons; no photos or illustrations to source.

---

## 8. Environments & deployment

- `cms/`: Payload + MongoDB (Atlas or self-hosted), deployed to Railway/Render/Fly; env vars `PAYLOAD_SECRET`, `DATABASE_URI`, `PAYLOAD_PUBLIC_SERVER_URL`, plus mail credentials once password-reset emails are wired up.
- `app/`: EAS Build (dev/preview/production profiles) + EAS Update for OTA JS pushes; API base URL injected via `app.config.ts`/`eas.json` per environment.
- CI: typecheck + lint (both packages), Payload collection type generation checked into `cms/payload-types.ts` and verified in CI so drift is caught.

---

## 9. Phased roadmap

1. **Foundation** — monorepo scaffolding (`app/`, `cms/`, pnpm workspaces); Payload collections + access control + auth; Expo app skeleton with fonts, gluestack theme tokens, and the `_layout.tsx` chain wired up but no real screens yet.
2. **Auth & group** — register/login, join-by-code / create-group, membership guard, tab shell with correct icons/active colors, empty states; `groups.features` schema (default all-on) + the `useFeatures()` hook + the Einstellungen screen stub, so every later phase builds its screens flag-aware from the start instead of retrofitting it.
3. **Fixtures** — Termine list, Neuer Termin (incl. weekly repeat), RSVP (respecting `features.rsvp`), Start's next-fixture card.
4. **Teams & results** — Termin-Detail team builder, auto-balance endpoint + manual assign/clear (respecting `features.autoBalance`/`features.strength`), Ergebnis erfassen (steppers, own goals, MVP), stats-recompute hook.
5. **Statistics & profiles** — Statistik screen (8 metrics × 2 scopes, podium, ranked list), Spielerprofil (incl. `legacyPlayers` read-only profiles).
6. **Historic data import** — `legacyPlayers`/`importBatches` collections, the `cms/src/import/` service, the CLI backfill script, dry-run/commit + duplicate detection, legacy-player claim endpoint; run the group's actual historic backfill before go-live so Statistik and Spielerprofil aren't empty on day one.
7. **Group management** — Gruppe screen (members, role filters, invite code share/regenerate, admin strength view), logout.
8. **Polish & release** — toast/animation parity, pull-to-refresh, loading/error states, push-notification reminders, EAS build + store submission prep.

---

## 10. Open items worth deciding before/while building

- **Strength editing — settled**: admin/organizer-only edits, with a data-derived `suggestedStrength` (§3.3) they can apply with one tap. Two follow-ups worth revisiting once real season data exists: whether `goalDiffPerGame` should also account for team-size imbalance on a given night, and whether to weight the composite by `position` (discount raw goals further for `abwehr`/`tor`).
- **Multi-group per user**: the `memberships` join table already supports it even though the v1 UI assumes one active group — worth a lightweight group-switcher in the header once a second group exists.
- **Push notification triggers**: "fixture created", "you haven't responded and kickoff is in 48h", "result posted" — none of this is in the prototype; treat as additive, phase-7+ scope.
- **Password reset flow**: needs transactional email (Payload supports this out of the box) — pick a provider (Resend/Postmark) before phase 2 if real auth ships first.
- **How much historic detail actually exists**: worth finding out early which of path A (match-by-match) or path B (lifetime totals only) the group actually has before phase 6 starts — it changes which CSV template and which collections matter, and it's plausible the honest answer is "a bit of A for the last two seasons, B (or nothing) for anything older."
- **Admin UI for import vs. CLI-only**: recommend shipping the CLI script first and only building the `/admin/import` page if more historic spreadsheets are expected to surface after go-live; a one-time backfill doesn't justify the UI work on its own.
- **Re-enabling a flag after running with it off**: recommend *not* backfilling — e.g. if `rsvp` was off for a month and gets switched back on, past fixtures simply have no `rsvps` rows (they were never collected) rather than trying to reconstruct who "would have" confirmed; attendance tracking just starts from the next fixture created after the flag flips.
- **More flags later**: worth watching whether the group asks for more of these over time — a handful more named booleans is still fine on `groups.features`, but somewhere past 8–10 it's worth revisiting the dedicated `featureFlags`-collection design mentioned in §3.8.
