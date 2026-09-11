'use client'

import { useEffect, useState } from 'react'
import { useReducedMotion } from 'motion/react'

import { LightRays } from '@/components/backgrounds/light-rays'

/**
 * The hero's moving light: React Bits' LightRays, tuned in Background Studio, falling
 * from the top in the brand blue.
 *
 * It follows the theme. On a light page it draws in light mode, whose output is
 * opaque white with blue ink, so it is multiplied into the page and the grid behind
 * still shows through; on a dark page it adds its light. It is left out for visitors
 * who ask for reduced motion, and until the theme is known so it never draws in the
 * wrong mode for a frame. In both cases the hero's still glow stands in for it.
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
      className={`pointer-events-none absolute inset-x-0 top-0 -z-10 h-[48rem] [mask-image:linear-gradient(to_bottom,#000_50%,transparent)] ${
        dark ? '' : 'mix-blend-multiply'
      }`}
    >
      <LightRays
        raysOrigin="top-center"
        raysColor={dark ? '#6aa2ff' : '#005eff'}
        lightMode={!dark}
        raysSpeed={1}
        lightSpread={0.9}
        rayLength={1.4}
        fadeDistance={1.1}
        followMouse
        mouseInfluence={0.08}
        noiseAmount={0.08}
        distortion={0.04}
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
