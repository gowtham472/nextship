'use client'

import { useEffect, useState } from 'react'

/**
 * Copies a snippet to the clipboard.
 *
 * The confirmation resets on a timer that is cleared on unmount, so navigating
 * away mid-countdown cannot set state on a component that no longer exists.
 * Failure is reported rather than swallowed: the Clipboard API is unavailable
 * over plain HTTP and in some embedded browsers, and a button that silently
 * does nothing reads as a broken page.
 *
 * Author: Gowtham
 */
export function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
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
          await navigator.clipboard.writeText(value)
          setState('copied')
        } catch {
          setState('failed')
        }
      }}
      className="shrink-0 rounded-md px-2 py-1 text-xs text-muted transition-colors hover:text-foreground"
      aria-label={`${label}: ${value}`}
    >
      {state === 'copied' ? 'Copied' : state === 'failed' ? 'Press Ctrl+C' : label}
    </button>
  )
}
