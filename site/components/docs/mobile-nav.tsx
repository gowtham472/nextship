'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { usePathname } from 'next/navigation'
import { ChevronRight, Menu, X } from 'lucide-react'

import { DocsSidebar } from '@/components/docs-sidebar'
import { DOCS_ORDER } from '@/lib/nav'

/**
 * The docs navigation on screens too narrow for the sidebar: a bar naming the
 * current page, which opens the full outline in a sheet.
 *
 * The sheet is portalled to the body because the sticky header's backdrop filter
 * makes it the containing block for anything fixed inside it. It closes on a link,
 * on Escape and on a tap outside, holds the page still behind it, and hands focus
 * back to the button that opened it.
 *
 * Author: Gowtham
 */
export function DocsMobileNav() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const opener = useRef<HTMLButtonElement>(null)
  const closer = useRef<HTMLButtonElement>(null)
  const current = DOCS_ORDER.find(
    (item) => pathname === `/docs/${item.slug}` || (item.slug === 'introduction' && pathname === '/docs')
  )

  useEffect(() => {
    if (!open) return
    closer.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    const overflow = document.body.style.overflow
    const returnTo = opener.current
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
      returnTo?.focus()
    }
  }, [open])

  return (
    <>
      <div className="sticky top-16 z-40 -mx-5 flex items-center gap-2 border-b border-border bg-background/85 px-5 py-2.5 backdrop-blur-xl sm:-mx-8 sm:px-8 lg:hidden">
        <button
          ref={opener}
          type="button"
          onClick={() => setOpen(true)}
          aria-expanded={open}
          className="flex items-center gap-2 rounded-md py-1 text-sm font-semibold"
        >
          <Menu className="h-4 w-4" aria-hidden="true" />
          Menu
        </button>
        {current ? (
          <>
            <ChevronRight className="h-3.5 w-3.5 text-muted" aria-hidden="true" />
            <span className="truncate text-sm text-muted">{current.title}</span>
          </>
        ) : null}
      </div>

      {open
        ? createPortal(
            <div className="fixed inset-0 z-[60] lg:hidden" role="dialog" aria-modal="true" aria-label="Documentation">
              <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setOpen(false)} aria-hidden="true" />
              <div className="absolute inset-y-0 left-0 w-[min(20rem,85vw)] overflow-y-auto border-r border-border bg-background px-5 py-5 shadow-2xl">
                <div className="mb-6 flex items-center justify-between">
                  <span className="text-sm font-semibold">Documentation</span>
                  <button
                    ref={closer}
                    type="button"
                    onClick={() => setOpen(false)}
                    className="rounded-md p-1.5 text-muted transition-colors hover:text-foreground"
                    aria-label="Close menu"
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
                <DocsSidebar onNavigate={() => setOpen(false)} />
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  )
}
