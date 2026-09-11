# Getting started

## Status (Phase 1 — Foundation, per implementation-plan.md §9)

**`app/`** — Expo + Expo Router + TypeScript + **gluestack-ui v2 (initialized) +
NativeWind v5-preview / Tailwind v4**, themed to match the prototype (colors,
radii, Barlow/Barlow Condensed fonts). Full route tree exists and bundles
(`npx tsc --noEmit` is clean; `npx expo export --platform ios` resolves and
bundles all 2000+ modules — see "Known rough edges" below for the one thing
that still needs your own machine to verify end-to-end):

- **Directory layout**: everything now lives at the `app/` project root
  (`app/app/` for routes, `app/lib/`, `app/theme/`, `app/types/`,
  `app/components/ui/`) rather than under a `src/` folder. This matches
  gluestack-ui's own convention — its CLI writes `components/ui/` at the
  project root, and its babel alias (`@` → `./`) has no fallback the way
  TypeScript's `paths` array does, so keeping code under `src/` while
  gluestack's own files sit at the root would mean two different meanings
  of `@/...` at runtime. Nothing needed to change in the `@/...` import
  strings themselves — only physical file locations.
- `(auth)/login` — fully built, matches the prototype's login screen (logo
  mark, headline, gradient CTA), wired to real email/password + invite-code
  fields per §3.5. Submit is currently stubbed to just flip local auth state
  — see the `TODO(cms)` comment in `app/app/(auth)/login.tsx`.
- The four tabs (Start/Termine/Statistik/Gruppe), the nested Termine/Gruppe
  stacks (`neu`, `[fixtureId]`, `[fixtureId]/ergebnis`, `einstellungen`), and
  `spieler/[playerId]` all exist as themed placeholder screens (dark bg, the
  real header component, a note on what goes there and which plan section
  covers it) — not yet the real UI from §4.5.
- `components/ui/gluestack-ui-provider/` is gluestack-ui's real, CLI-generated
  provider (wired into `app/app/_layout.tsx`, forced to `mode="dark"` since
  the app is dark-only by design). `components/ui/primitives.tsx` is still a
  **temporary stand-in** for gluestack's actual Box/Text/VStack/HStack/
  Pressable components — `init` has run, but `add` (which needs its own
  interactive terminal, same as `init` did) hasn't. Run this yourself from
  `app/` in a normal terminal, then fold the generated components into
  `components/ui/` under the same names so the screens that already import
  from `@/components/ui/primitives` pick them up:
  ```
  npx gluestack-ui add box text vstack hstack pressable button input switch
  ```
- `global.css` is Tailwind v4's CSS-first config (`@theme inline`, no more
  `tailwind.config.js` — that file is gone; it was v3-style and dead once
  Tailwind v4 took over). It carries two token sets: gluestack's own generic
  semantic tokens (`--color-primary`, `--color-card`, `--color-destructive`,
  …), remapped onto the Hallenkick palette so components you `add` later
  match the app instead of a generic gray theme; and the Hallenkick-specific
  tokens the hand-written screens already use directly (`bg-bg-app`,
  `text-ink`, `border-hairline`, `font-heading`, …), ported 1:1 from the old
  `tailwind.config.js`. Both sets are flat, non-switching dark values — the
  app is dark-only, so the light/dark-media/`.dark`/`.light` blocks gluestack
  generated all currently hold the same values. If a real light mode is ever
  added, only those blocks need to diverge.

**`cms/`** — PayloadCMS on MongoDB, Next.js App Router integration. Builds
clean (`npx next build` and `npx tsc --noEmit` both pass). Three collections
so far: `users` (auth), `groups` (incl. `features` — §3.8), `memberships`
(role + strength + suggestedStrength scaffolding — §3.3). Access control is
still the Payload default (`read: () => true` etc.) with `TODO(access)`
comments marking every spot that needs the real group-scoped rules from §3.4
— **don't point this at anything but a local dev database until that's
done.** The rest of the collections in §3.1 (seasons, fixtures, rsvps,
lineups, matchResults, playerSeasonStats, playerCareerStats, legacyPlayers,
importBatches) aren't created yet.

## Prerequisites

- Node.js 22+ (Payload 3.88 / Next 16 need a recent Node)
- A MongoDB instance for `cms/` — local (`mongod`) or Atlas both work; set
  `DATABASE_URI` in `cms/.env`
- npm (this repo uses npm workspaces — `pnpm` isn't installable in every
  environment, npm ships with Node and works everywhere)

## Running `app/`

```
cd app
npm start        # then press w/i/a, or scan the QR code with Expo Go
```

## Running `cms/`

```
cd cms
cp .env.example .env   # then fill in DATABASE_URI and a real PAYLOAD_SECRET
npm run dev
```

Visit `http://localhost:3000/admin` to create the first admin user.

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
5. **Verifying a real Hermes/native bundle needs a normal terminal on your
   Mac, not this assistant's bridged shell.** That bridge runs commands
   inside a small Linux VM, and `--platform ios` bundles all app code
   successfully there (2000+ modules resolve cleanly) but fails at the very
   last step — invoking the `hermesc` binary to emit bytecode — because that
   VM doesn't have a matching `hermesc` build for its architecture. That's a
   limitation of the bridged shell, not a code issue; run `npx expo export
   --platform ios` (or `--android`, or just `npm start` and press `i`/`a`)
   yourself in a real terminal to get a genuine end-to-end check.
