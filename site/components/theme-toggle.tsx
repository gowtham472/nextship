'use client'

import { useEffect, useState } from 'react'

import { MoonIcon, SunIcon } from '@/components/brand'
import { applyTheme, readTheme, type Theme } from '@/lib/theme'

/**
 * Cycles light, dark, system.
 *
 * The button renders a fixed-size placeholder until it has mounted. The stored
 * preference lives in localStorage, which the server cannot read, so rendering
 * the real icon on the server would guarantee a hydration mismatch and a flash
 * of the wrong icon. Reserving the space keeps the header from shifting.
 *
 * Author: Gowtham
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | null>(null)

  useEffect(() => setTheme(readTheme()), [])

  if (theme === null) {
    return <div className="h-[34px] w-[34px]" aria-hidden="true" />
  }

  const next: Theme = theme === 'light' ? 'dark' : theme === 'dark' ? 'system' : 'light'

  return (
    <button
      type="button"
      onClick={() => {
        applyTheme(next)
        setTheme(next)
      }}
      className="rounded-md p-2 text-muted transition-colors hover:text-foreground"
      // The label names the current state rather than the action, because a
      // screen reader user needs to know which of the three it is now.
      aria-label={`Theme: ${theme}. Switch to ${next}.`}
      title={`Theme: ${theme}`}
    >
      {theme === 'dark' ? <MoonIcon /> : theme === 'light' ? <SunIcon /> : <SystemIcon />}
    </button>
  )
}

function SystemIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-[18px] w-[18px]" aria-hidden="true">
      <rect x="2.5" y="4" width="19" height="13" rx="2" />
      <path strokeLinecap="round" d="M8.5 20.5h7" />
    </svg>
  )
}
