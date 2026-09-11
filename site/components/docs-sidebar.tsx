'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { DOCS_NAV } from '@/lib/nav'

/**
 * The docs navigation.
 *
 * A client component only because it needs the current path to mark the active
 * link. The outline itself is static, so it is imported rather than passed down
 * and never crosses the server boundary as serialised props.
 *
 * Author: Gowtham
 */
export function DocsSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname()

  return (
    <nav aria-label="Documentation" className="space-y-8">
      {DOCS_NAV.map((section) => (
        <div key={section.title}>
          <h2 className="text-xs font-semibold tracking-wide uppercase">{section.title}</h2>
          <ul className="mt-3 space-y-0.5 border-l border-border">
            {section.items.map((item) => {
              const href = `/docs/${item.slug}`
              // The introduction is reachable at both /docs and /docs/introduction,
              // so it stays highlighted at either address.
              const active = pathname === href || (item.slug === 'introduction' && pathname === '/docs')

              return (
                <li key={item.slug}>
                  <Link
                    href={href}
                    onClick={onNavigate}
                    aria-current={active ? 'page' : undefined}
                    className={`-ml-px block border-l py-1.5 pl-4 text-sm transition-colors ${
                      active
                        ? 'border-accent font-semibold text-accent-text'
                        : 'border-transparent text-muted hover:border-border-strong hover:text-foreground'
                    }`}
                  >
                    {item.title}
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </nav>
  )
}
