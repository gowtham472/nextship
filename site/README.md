# nextship site

The marketing page and documentation, exported as static files and served by Cloudflare.

Live at https://nextship.saap.workers.dev, which is also `SITE_URL` in
[`lib/site.ts`](./lib/site.ts). Open Graph images, canonical links and the sitemap are all
absolute, so they are built from that one constant. Moving the site is a change to that
line.

```bash
cd site
npm install
npm run dev
```

## Why this is not in the pnpm workspace

The workspace is `packages/*`, and the release workflow runs `pnpm install --frozen-lockfile`
then `pnpm build` before publishing the CLI. Adding a Next.js app to that workspace would
put React, Next.js and a full site build on the critical path of every npm publish, for a
package that does not depend on any of it.

So the site installs its own dependencies with npm and is deployed on its own. The cost is
one extra `npm install`; the benefit is that the publish path cannot be broken by a change
to a marketing page.
## Layout

| Path | What lives there |
|---|---|
| `app/page.tsx` | The marketing page. Content is inline, because it is prose rather than data |
| `app/docs/[[...slug]]/page.tsx` | Every docs page. An optional catch-all, so `/docs` **is** the introduction rather than redirecting to it |
| `content/docs/*.mdx` | The documentation itself. Frontmatter needs `title` and `description` |
| `lib/nav.ts` | The reading order, declared rather than derived from the filesystem |
| `lib/docs.ts` | Loading, validation and heading extraction |
| `components/mdx.tsx` | How each Markdown element renders |
| `components/docs/` | The docs page parts: the outline that marks the section being read, code blocks with a copy button, callouts and the mobile menu |
| `components/search.tsx`, `lib/search.ts` | Search, over an index of every page and heading built at build time |
| `components/ui/` | Components adapted from Magic UI, credited in `THIRD_PARTY_NOTICES.md` |
| `components/backgrounds/` | React Bits' LightRays, the hero's moving light, under its own licence in `THIRD_PARTY_NOTICES.md` |
| `assets/` | The wordmark from `brand/nextship.png` and its white-lettered twin for the dark theme, copied so the site builds on its own |
| `app/icon.png`, `app/apple-icon.png` | The favicon and home screen icon: `brand/nextship-favicon.png` scaled to 96 and 180 pixels |
| `app/opengraph-image.png` | `brand/logo.png`, the image a shared link previews with |

## Adding a page

1. Write `content/docs/<slug>.mdx` with `title` and `description` frontmatter
2. Add it to `DOCS_NAV` in `lib/nav.ts`

Both steps are required, and the build enforces it in **both** directions: a navigation
entry with no file fails, and a file nothing links to fails. Those are the two quiet
failure modes of a docs site, so neither is allowed to be quiet.

A passage the reader must not skim past goes in `<Callout type="note">` or
`<Callout type="warning">`, with a blank line on each side of its content so the Markdown
inside is parsed. A fence tagged `bash` is shown as a command to run and an untagged one
as output.

Sort order is editorial, not alphabetical, which is why the outline is declared by hand.
A directory listing would put "commands" before "installation" and teach the wrong
sequence.

## Theming

One palette declared once on `:root` as light, with dark redefining only the tokens.
A component never needs to know which theme it is in, and a colour cannot exist in one
theme but not the other. The palette is the wordmark's: white, the blue of "Ship"
(`#005EFF`) and the yellow of its dot (`#FDCF18`), on a deep blue ground in the dark
theme. Text is set in Plus Jakarta Sans and code in Geist Mono.

Motion is CSS wherever it can be. The hero's entrance and the terminal's playback run from
the first paint with no JavaScript, and their text is in the page from the start; sections
rise in with scroll-driven animation where the browser supports it and are simply there
where it does not. The one exception is the hero's light, which is WebGL: it pauses when
it scrolls out of view, and the still glow under it is what shows before JavaScript runs,
without WebGL, or under reduced motion. Every animation stops for a visitor who asks for
reduced motion.

An explicit choice is stored in `localStorage` and applied by an inline script before the
first paint, so a visitor who chose a theme never sees the other one flash. "System" is
stored as the absence of a value rather than a resolved colour, so the page keeps
following the operating system when it changes later.

## Building

```bash
npm run build      # writes every page to out/ as static files
npm run typecheck
```

## Deploying

`out/` is the whole site, including `_headers` from `public/`, which sets security headers
and year-long caching for the content-hashed assets. Cloudflare serves it as a Worker with
static assets and no script: `wrangler.jsonc` points Wrangler at `out/` and answers
anything not found with `404.html`. The Worker is connected to this repository through
Workers Builds, with the Cloudflare GitHub app limited to this repository alone:

| Setting | Value |
|---|---|
| Root directory | `site` |
| Build command | `npm ci && npm run build` |
| Deploy command | `npx wrangler deploy` |
| Build variables | `NODE_VERSION` set to `22`, `SKIP_DEPENDENCY_INSTALL` set to `1` |

The Worker's name in the dashboard is the `name` in `wrangler.jsonc`, `nextship`.

Cloudflare installs dependencies itself before the build command runs, and it chooses
pnpm for this repository whatever `site/` declares: it installed the workspace's CLI
packages instead of the site, and the build failed with `next: not found`.
`SKIP_DEPENDENCY_INSTALL` turns that step off, and the build command installs the site
from its own lockfile with `npm ci`.
