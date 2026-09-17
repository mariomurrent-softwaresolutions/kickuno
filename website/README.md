# Kickuno website

A static-exportable Next.js marketing site for Kickuno, scaffolded the same
way as `prop-desk-website` (Next.js 16 + Tailwind v4, `output: "export"`,
same script names, same `site-metadata.ts` / `CookieBanner` / legal-page
pattern) — minus the OpenAI Sites hosting plumbing (`.openai/hosting.json`,
`chatgpt-auth.ts`, Drizzle/D1), which is tied to a project_id specific to
that platform and wasn't wanted here. Add those back later if Kickuno also
moves onto that hosting platform.

## Prerequisites

- Node.js `>=22.13.0`

## Quick Start

```bash
npm install
npm run dev
npm run build
```

The site is meant to be deployed from the exported `out/` or `dist-web/`
directory on any normal webserver.

## Included Shape

- edit site code under `app/`
- static SEO metadata lives in `app/site-metadata.ts`
- `public/` contains the logo, social image, and screenshots
- brand tokens (colors, fonts) mirror `app/theme/tokens.ts` and
  `app.json` from the Kickuno app itself — Barlow Condensed / Barlow,
  dark background, red/green/gold accents — not the ConfigHarbor
  green-on-paper look.

## Screenshots (still needed)

`app/HomeGallery.tsx`'s `galleryImages` array points at
`public/screenshots/kickuno-termine.png`, `kickuno-team-builder.png`,
`kickuno-ergebnis.png`, and `kickuno-statistik.png`. None of those files
exist yet, so each spot currently renders a dashed "Screenshot folgt"
placeholder (see `ScreenshotImage` in `HomeGallery.tsx`) instead of a
broken image. Once real screenshots are available, just drop files with
those exact names into `public/screenshots/` — no code changes needed,
the placeholders disappear automatically and the lightbox gallery starts
working with the real images.

## Useful Commands

- `npm run dev`: start local development
- `npm run build`: produce the static export in `out/`
- `npm run build:web`: copy the static export to `dist-web/`
- `npm test`: build the site and verify the rendered HTML
- `npm run lint`: ESLint (same `eslint-config-next` setup as the template)

## Legal pages

`app/privacy/page.tsx` (Datenschutz) and `app/imprint/page.tsx` (Impressum)
are drafted from what the Kickuno app actually stores (see the project's
`getting-started.md`), reusing MeeCode's operator details from the
ConfigHarbor site. **These are drafts, not legal advice** — have them
reviewed before publishing, especially once push notifications or a
concrete hosting provider are finalized.

## Learn More

- [Next.js static export](https://nextjs.org/docs/app/building-your-application/deploying/static-exports)
