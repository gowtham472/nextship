import { getAllDocs } from '@/lib/docs'
import { markdownPath } from '@/lib/markdown'
import { DOCS_NAV } from '@/lib/nav'
import { SITE_URL } from '@/lib/site'

/**
 * /llms.txt, the index an AI agent reads first, in the shape llmstxt.org proposes: a
 * title, a one-paragraph summary, the facts most often got wrong, then every docs page
 * as markdown, grouped as the site's navigation groups them.
 *
 * The facts are ones the docs already state and that a run has shown (the evidence page
 * gives the source of each), kept few enough that an agent quoting them cannot mislead.
 * The page list is built from the navigation, so a new page appears here with no
 * second edit.
 *
 * Author: Gowtham
 */
// Required by output: 'export'. These are route handlers, so Next.js refuses to
// emit them as files until the route says it never depends on a request.
export const dynamic = 'force-static'

const REPOSITORY = 'https://github.com/gowtham472/nextship'

const SUMMARY =
  'nextship is an open-source CLI that deploys a Next.js app to infrastructure you own: any Ubuntu or ' +
  'Debian server you can reach over SSH, or DigitalOcean App Platform. It builds inside Docker with ' +
  "Next.js's own Deployment Adapter, keeps only the files the build traced, and releases behind a " +
  'health check. No Dockerfile, no next.config edits, no infrastructure code.'

const FACTS = [
  'Install with `npm install -g nextship-cli`. The package is `nextship-cli`; the command is `nextship`.',
  'Needs Node.js 22 or newer, Docker 23 or newer, and Next.js 16.2 or newer.',
  'To a server: `nextship server add user@host`, then `nextship deploy`. The server must run Ubuntu 22.04, Ubuntu 24.04 or Debian 12, and is reached with your own SSH; no cloud token is involved.',
  'To DigitalOcean App Platform: set `DIGITALOCEAN_TOKEN`, then `nextship deploy`.',
  'Every command that changes something prints a plan and changes nothing until it is given `--yes`.',
  "Next.js's adapter compatibility suite passes in full: 1123 of 1123 suites on 16.4.0-canary.22, and 1108 of 1108 on 16.3.5.",
  'One instance per app. Multiple instances, and Vercel products such as Analytics and Speed Insights, are not supported.',
  'The server target has run on DigitalOcean Droplets and a Proxmox VM (amd64, Ubuntu 24.04) and on local test containers (arm64, Ubuntu 24.04 and Debian 12). It has not yet run on Hetzner, on a real arm64 machine, on a real Debian 12 server, or with a certificate for a real domain.',
  'Apache-2.0. No telemetry: nextship talks only to your server or your cloud account.',
]

export async function GET() {
  const docs = new Map((await getAllDocs()).map((doc) => [doc.slug, doc]))

  const sections = DOCS_NAV.map((section) => {
    const links = section.items.map((item) => {
      const doc = docs.get(item.slug)
      if (!doc) throw new Error(`lib/nav.ts lists "${item.slug}", which getAllDocs did not return.`)
      return `- [${doc.title}](${SITE_URL}${markdownPath(doc.slug)}): ${doc.description}`
    })
    return `## ${section.title}\n\n${links.join('\n')}`
  })

  const text = [
    '# nextship',
    `> ${SUMMARY}`,
    FACTS.map((fact) => `- ${fact}`).join('\n'),
    ...sections,
    [
      '## Optional',
      '',
      `- [All documentation in one file](${SITE_URL}/llms-full.txt): every page above, in reading order`,
      `- [Source code](${REPOSITORY}): the CLI, the adapter and this site`,
      `- [Changelog](${REPOSITORY}/blob/main/CHANGELOG.md): what each version changed, and the current version`,
      '- [npm package](https://www.npmjs.com/package/nextship-cli)',
    ].join('\n'),
  ].join('\n\n')

  return new Response(`${text}\n`, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
}
