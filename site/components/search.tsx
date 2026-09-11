'use client'

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { CornerDownLeft, FileText, Hash, Search as SearchIcon } from 'lucide-react'

import type { SearchEntry } from '@/lib/search'

/**
 * Docs search, opened from the header or with Ctrl K, Cmd K or `/`.
 *
 * It searches an index built at build time and shipped with the page, so it needs
 * no server, no third-party service and no network round trip. Every word typed
 * must appear in an entry, and a heading must contain the first word itself, so a
 * page whose title matches does not pull in all of its unrelated sections. Titles
 * that start with the first word rank first, then titles that contain it, and a page
 * ranks ahead of its own headings.
 *
 * The dialog is portalled to the body, because the sticky header's backdrop filter
 * makes the header the containing block for anything fixed inside it.
 *
 * Author: Gowtham
 */

const LIMIT = 8

function rank(entries: SearchEntry[], query: string): SearchEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const first = words[0]
  if (!first) return entries.filter((entry) => entry.kind === 'page').slice(0, LIMIT)

  return entries
    .flatMap((entry) => {
      const haystack = `${entry.title} ${entry.page} ${entry.section} ${entry.description}`.toLowerCase()
      if (!words.every((word) => haystack.includes(word))) return []
      const title = entry.title.toLowerCase()
      if (entry.kind === 'heading' && !title.includes(first)) return []
      const score = (title.startsWith(first) ? 0 : title.includes(first) ? 2 : 4) + (entry.kind === 'page' ? 0 : 1)
      return [{ entry, score }]
    })
    .sort((a, b) => a.score - b.score)
    .slice(0, LIMIT)
    .map(({ entry }) => entry)
}

export function Search({ entries }: { entries: SearchEntry[] }) {
  const router = useRouter()
  const listId = useId()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [shortcut, setShortcut] = useState('Ctrl K')
  const trigger = useRef<HTMLButtonElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const results = useMemo(() => rank(entries, query), [entries, query])

  // Only the browser knows the platform, so the hint starts as Ctrl K and
  // becomes the Command key on Apple devices once the page has mounted.
  useEffect(() => {
    if (/Mac|iPhone|iPad/.test(navigator.userAgent)) setShortcut('⌘K')
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const typing = (event.target as HTMLElement | null)?.closest('input, textarea, [contenteditable="true"]')
      if ((event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey)) || (event.key === '/' && !typing)) {
        event.preventDefault()
        setOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (!open) return
    input.current?.focus()
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = overflow
    }
  }, [open])

  const close = useCallback(() => {
    setOpen(false)
    setQuery('')
    setActive(0)
    trigger.current?.focus()
  }, [])

  const go = (entry: SearchEntry) => {
    close()
    router.push(entry.href)
  }

  return (
    <>
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-9 items-center gap-2 rounded-lg border border-border bg-background-subtle px-2.5 text-sm text-muted transition-colors hover:border-border-strong hover:text-foreground sm:w-56 lg:w-64"
        aria-label="Search documentation"
      >
        <SearchIcon className="h-4 w-4" aria-hidden="true" />
        <span className="hidden flex-1 text-left sm:inline">Search docs</span>
        <kbd className="hidden rounded border border-border bg-background px-1.5 font-mono text-[11px] sm:inline">
          {shortcut}
        </kbd>
      </button>

      {open
        ? createPortal(
            <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true" aria-label="Search documentation">
              <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={close} aria-hidden="true" />
              <div className="relative mx-auto mt-[12vh] w-[min(40rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-border bg-background shadow-2xl">
                <div className="flex items-center gap-3 border-b border-border px-4">
                  <SearchIcon className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
                  <input
                    ref={input}
                    value={query}
                    onChange={(event) => {
                      setQuery(event.target.value)
                      setActive(0)
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'ArrowDown') {
                        event.preventDefault()
                        setActive((index) => Math.min(index + 1, results.length - 1))
                      } else if (event.key === 'ArrowUp') {
                        event.preventDefault()
                        setActive((index) => Math.max(index - 1, 0))
                      } else if (event.key === 'Enter') {
                        const entry = results[active]
                        if (entry) {
                          event.preventDefault()
                          go(entry)
                        }
                      } else if (event.key === 'Escape') {
                        event.preventDefault()
                        close()
                      } else if (event.key === 'Tab') {
                        // The input is the dialog's only control, so focus stays in it.
                        event.preventDefault()
                      }
                    }}
                    role="combobox"
                    aria-expanded="true"
                    aria-controls={listId}
                    aria-activedescendant={results[active] ? `${listId}-${active}` : undefined}
                    aria-autocomplete="list"
                    placeholder="Search the documentation"
                    className="h-14 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted"
                  />
                  <kbd className="rounded border border-border px-1.5 font-mono text-[11px] text-muted">Esc</kbd>
                </div>

                {results.length === 0 ? (
                  <p className="px-4 py-12 text-center text-sm text-muted">No page mentions &ldquo;{query}&rdquo;.</p>
                ) : null}
                <ul id={listId} role="listbox" aria-label="Results" className="max-h-[min(24rem,60vh)] overflow-y-auto p-2">
                  {results.map((entry, index) => {
                    const selected = index === active
                    const Icon = entry.kind === 'page' ? FileText : Hash
                    return (
                      <li
                        key={entry.href}
                        id={`${listId}-${index}`}
                        role="option"
                        aria-selected={selected}
                        onMouseMove={() => setActive(index)}
                        onClick={() => go(entry)}
                        className={`flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 ${
                          selected ? 'bg-accent text-accent-foreground' : ''
                        }`}
                      >
                        <Icon className={`h-4 w-4 shrink-0 ${selected ? '' : 'text-muted'}`} aria-hidden="true" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{entry.title}</p>
                          <p className={`truncate text-xs ${selected ? 'text-white/75' : 'text-muted'}`}>
                            {entry.kind === 'page' ? entry.description : `${entry.section} › ${entry.page}`}
                          </p>
                        </div>
                        {selected ? <CornerDownLeft className="h-4 w-4 shrink-0" aria-hidden="true" /> : null}
                      </li>
                    )
                  })}
                </ul>

                <div className="flex items-center gap-4 border-t border-border px-4 py-2.5 text-xs text-muted">
                  <span>
                    <kbd className="font-mono">↑↓</kbd> to move
                  </span>
                  <span>
                    <kbd className="font-mono">↵</kbd> to open
                  </span>
                  <span>
                    <kbd className="font-mono">Esc</kbd> to close
                  </span>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  )
}
