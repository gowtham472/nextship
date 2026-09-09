# nextship site

The marketing page and documentation, at [nextship.dev](https://nextship.dev).

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

## Adding a page

1. Write `content/docs/<slug>.mdx` with `title` and `description` frontmatter
2. Add it to `DOCS_NAV` in `lib/nav.ts`

Both steps are required, and the build enforces it in **both** directions: a navigation
entry with no file fails, and a file nothing links to fails. Those are the two quiet
failure modes of a docs site, so neither is allowed to be quiet.

Sort order is editorial, not alphabetical, which is why the outline is declared by hand.
A directory listing would put "commands" before "installation" and teach the wrong
sequence.

## Theming

One palette declared once on `:root` as light, with dark redefining only the tokens.
A component never needs to know which theme it is in, and a colour cannot exist in one
theme but not the other.

An explicit choice is stored in `localStorage` and applied by an inline script before the
first paint, so a visitor who chose a theme never sees the other one flash. "System" is
stored as the absence of a value rather than a resolved colour, so the page keeps
following the operating system when it changes later.

## Building

```bash
npm run build      # every page is prerendered; there is nothing to render per request
npm run typecheck
```
