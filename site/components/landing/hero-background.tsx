'use client'

import { useEffect, useState } from 'react'
import { useReducedMotion } from 'motion/react'

import { DotGrid } from '@/components/backgrounds/dot-grid'

/**
 * The hero's field of dots: React Bits' DotGrid, lit in the brand blue where the pointer
 * passes, rippling when it sweeps fast and when the page is clicked. Read as a rack of
 * status lights, which is what a page about your own server should put behind its
 * headline.
 *
 * It follows the theme, from the same tokens as the rest of the page. It fades out
 * toward the edges and below the fold, so the headline always sits on a quiet patch.
 * It is left out for visitors who ask for reduced motion, and until the theme is known
 * so it never draws in the wrong colours for a frame; the hero's still glow stands in.
 *
 * Author: Gowtham
 */
export function HeroBackground() {
  const dark = useDarkTheme()
  const reduced = useReducedMotion()
  if (dark === null || reduced) return null

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[52rem] [mask-image:radial-gradient(ellipse_80%_70%_at_50%_30%,#000_35%,transparent_85%)]"
    >
      <DotGrid
        dotSize={3}
        gap={22}
        baseColor={dark ? '#1e2d57' : '#cfd9ee'}
        activeColor={dark ? '#6aa2ff' : '#005eff'}
        proximity={140}
        speedTrigger={120}
        shockRadius={220}
      />
    </div>
  )
}

/**
 * Whether the page is showing its dark theme, or null before that is known. An
 * explicit choice is the `data-theme` attribute; without one the operating system
 * decides. Both can change while the page is open, so both are watched.
 */
function useDarkTheme(): boolean | null {
  const [dark, setDark] = useState<boolean | null>(null)

  useEffect(() => {
    const root = document.documentElement
    const system = window.matchMedia('(prefers-color-scheme: dark)')
    const resolve = () => {
      const chosen = root.getAttribute('data-theme')
      setDark(chosen ? chosen === 'dark' : system.matches)
    }

    resolve()
    const observer = new MutationObserver(resolve)
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] })
    system.addEventListener('change', resolve)
    return () => {
      observer.disconnect()
      system.removeEventListener('change', resolve)
    }
  }, [])

  return dark
}
