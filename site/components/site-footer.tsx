import Link from 'next/link'

import { GitHubIcon, Logomark } from '@/components/brand'
import { REPOSITORY } from '@/components/site-header'

const COLUMNS = [
  {
    title: 'Documentation',
    links: [
      { href: '/docs', label: 'Introduction' },
      { href: '/docs/quick-start', label: 'Quick start' },
      { href: '/docs/commands', label: 'CLI reference' },
      { href: '/docs/how-it-works', label: 'How it works' },
    ],
  },
  {
    title: 'Guides',
    links: [
      { href: '/docs/deploying', label: 'Deploying' },
      { href: '/docs/environment-variables', label: 'Environment variables' },
      { href: '/docs/custom-domains', label: 'Custom domains' },
      { href: '/docs/rollbacks-and-logs', label: 'Rollbacks and logs' },
    ],
  },
  {
    title: 'Project',
    links: [
      { href: `${REPOSITORY}`, label: 'GitHub', external: true },
      { href: `${REPOSITORY}/blob/main/CHANGELOG.md`, label: 'Changelog', external: true },
      { href: '/docs/security', label: 'Security' },
      { href: `${REPOSITORY}/blob/main/LICENSE`, label: 'Apache 2.0', external: true },
    ],
  },
]

export function SiteFooter() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto max-w-6xl px-5 py-14 sm:px-8">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <span className="flex items-center gap-2 text-[15px] font-semibold tracking-tight">
              <Logomark />
              nextship
            </span>
            <p className="mt-3 max-w-52 text-sm leading-relaxed text-muted">
              Your code, your cloud account, your bill, your region.
            </p>
          </div>

          {COLUMNS.map((column) => (
            <div key={column.title}>
              <h2 className="text-sm font-medium">{column.title}</h2>
              <ul className="mt-3 space-y-2.5">
                {column.links.map((link) => (
                  <li key={link.label}>
                    {'external' in link && link.external ? (
                      <a
                        href={link.href}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="text-sm text-muted transition-colors hover:text-foreground"
                      >
                        {link.label}
                      </a>
                    ) : (
                      <Link href={link.href} className="text-sm text-muted transition-colors hover:text-foreground">
                        {link.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 flex flex-col gap-4 border-t border-border pt-8 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted">
            Copyright 2026 Gowtham and Ragul D. Licensed under Apache 2.0.
          </p>
          <a
            href={REPOSITORY}
            target="_blank"
            rel="noreferrer noopener"
            className="flex items-center gap-2 text-sm text-muted transition-colors hover:text-foreground"
          >
            <GitHubIcon className="h-4 w-4" />
            gowtham472/nextship
          </a>
        </div>
      </div>
    </footer>
  )
}
