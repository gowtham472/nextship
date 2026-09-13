'use client'

import { useEffect, useState } from 'react'
import { Check, Copy } from 'lucide-react'

/**
 * Copies a snippet to the clipboard.
 *
 * `value` is either the text itself or a function that reads it when clicked, which
 * is how a code block copies exactly what it rendered. `iconOnly` drops the visible
 * word for headers too narrow to spare it; the state is still announced to screen
 * readers, and the icon still changes to a check. The confirmation resets on a
 * timer that is cleared on unmount, so navigating away mid-countdown cannot set state
 * on a component that no longer exists. Failure is reported rather than swallowed:
 * the Clipboard API is unavailable over plain HTTP and in some embedded browsers, and
 * a button that silently does nothing reads as a broken page.
 *
 * Author: Gowtham
 */
export function CopyButton({
  value,
  label,
  iconOnly = false,
}: {
  value: string | (() => string)
  label: string
  iconOnly?: boolean
}) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')

  useEffect(() => {
    if (state === 'idle') return
    const timer = window.setTimeout(() => setState('idle'), 2000)
    return () => window.clearTimeout(timer)
  }, [state])

  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(typeof value === 'string' ? value : value())
          setState('copied')
        } catch {
          setState('failed')
        }
      }}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-md text-xs text-muted transition-colors hover:bg-card-hover hover:text-foreground ${iconOnly ? 'p-1.5' : 'px-2 py-1'}`}
      title={iconOnly ? label : undefined}
      aria-label={label}
    >
      {state === 'copied' ? (
        <Check className="h-3.5 w-3.5 text-accent-text" aria-hidden="true" />
      ) : (
        <Copy className="h-3.5 w-3.5" aria-hidden="true" />
      )}
      <span aria-live="polite" className={iconOnly && state !== 'failed' ? 'sr-only' : undefined}>
        {state === 'copied' ? 'Copied' : state === 'failed' ? 'Press Ctrl+C' : 'Copy'}
      </span>
    </button>
  )
}
