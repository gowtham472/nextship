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
    <nav aria-label="Documentation" className="space-y-7">
      {DOCS_NAV.map((section) => (
        <div key={section.title}>
          <h2 className="px-3 text-xs font-medium tracking-wide text-muted uppercase">{section.title}</h2>
          <ul className="mt-2 space-y-0.5">
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
                    className={`block rounded-md px-3 py-1.5 text-sm transition-colors ${
                      active
                        ? 'bg-card-hover font-medium text-foreground'
                        : 'text-muted hover:text-foreground'
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
