import Link from 'next/link'

import { GitHubIcon, Wordmark } from '@/components/brand'
import { ThemeToggle } from '@/components/theme-toggle'

const LINKS = [
  { href: '/docs', label: 'Docs' },
  { href: '/docs/commands', label: 'CLI' },
  { href: '/docs/how-it-works', label: 'How it works' },
]

export const REPOSITORY = 'https://github.com/gowtham472/nextship'

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-5 sm:px-8">
        <Link href="/" className="shrink-0 transition-opacity hover:opacity-70" aria-label="nextship home">
          <Wordmark />
        </Link>

        <nav className="hidden items-center gap-1 sm:flex" aria-label="Main">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-md px-3 py-1.5 text-sm text-muted transition-colors hover:text-foreground"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-1">
          <ThemeToggle />
          <a
            href={REPOSITORY}
            target="_blank"
            rel="noreferrer noopener"
            className="rounded-md p-2 text-muted transition-colors hover:text-foreground"
            aria-label="nextship on GitHub"
          >
            <GitHubIcon />
          </a>
        </div>
      </div>
    </header>
  )
}
