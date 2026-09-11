'use client'

import { useEffect, useState } from 'react'
import { ArrowUp, SquarePen } from 'lucide-react'

import type { Heading } from '@/lib/docs'

/**
 * The on-this-page outline, marking the section being read.
 *
 * A heading becomes current once it passes into the top third of the viewport below
 * the sticky header, so the mark moves when a section starts rather than when its
 * heading finally leaves the screen, and it stays put through a long section.
 *
 * Author: Gowtham
 */
export function TableOfContents({ headings, editUrl }: { headings: Heading[]; editUrl: string }) {
  const [active, setActive] = useState(headings[0]?.id ?? '')

  useEffect(() => {
    const targets = headings
      .map((heading) => document.getElementById(heading.id))
      .filter((element): element is HTMLElement => element !== null)

    const observer = new IntersectionObserver(
      (entries) => {
        const topmost = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
        if (topmost) setActive(topmost.target.id)
      },
      { rootMargin: '-72px 0px -66% 0px' }
    )

    targets.forEach((target) => observer.observe(target))
    return () => observer.disconnect()
  }, [headings])

  return (
    <div>
      {headings.length > 0 ? (
        <>
          <p className="text-xs font-semibold tracking-wide uppercase">On this page</p>
          <ul className="mt-3 space-y-0.5 border-l border-border text-sm">
            {headings.map((heading) => {
              const current = heading.id === active
              return (
                <li key={heading.id}>
                  <a
                    href={`#${heading.id}`}
                    aria-current={current ? 'location' : undefined}
                    className={`-ml-px block border-l py-1 leading-snug transition-colors ${
                      heading.level === 3 ? 'pl-7' : 'pl-4'
                    } ${
                      current
                        ? 'border-accent font-medium text-accent-text'
                        : 'border-transparent text-muted hover:border-border-strong hover:text-foreground'
                    }`}
                  >
                    {heading.text}
                  </a>
                </li>
              )
            })}
          </ul>
        </>
      ) : null}

      <div className="mt-8 space-y-3 border-t border-border pt-6 text-sm">
        <a
          href={editUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="flex items-center gap-2 text-muted transition-colors hover:text-foreground"
        >
          <SquarePen className="h-4 w-4" aria-hidden="true" />
          Edit this page on GitHub
        </a>
        <button
          type="button"
          onClick={() =>
            window.scrollTo({
              top: 0,
              behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
            })
          }
          className="flex items-center gap-2 text-muted transition-colors hover:text-foreground"
        >
          <ArrowUp className="h-4 w-4" aria-hidden="true" />
          Back to top
        </button>
      </div>
    </div>
  )
}
