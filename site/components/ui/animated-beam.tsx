'use client'

import { useEffect, useId, useState, type RefObject } from 'react'
import { motion, useReducedMotion } from 'motion/react'

/**
 * A line between two elements, with a pulse of light travelling along it.
 *
 * Adapted from Magic UI's AnimatedBeam, MIT License, Copyright (c) Magic UI; the
 * licence is in THIRD_PARTY_NOTICES.md. Reduced to straight beams in the brand's
 * colours. For visitors who ask for reduced motion the line stays and the light
 * is left out.
 *
 * Author: Magic UI, adapted by Gowtham
 */
export function AnimatedBeam({
  containerRef,
  fromRef,
  toRef,
  delay,
  duration,
}: {
  containerRef: RefObject<HTMLElement | null>
  fromRef: RefObject<HTMLElement | null>
  toRef: RefObject<HTMLElement | null>
  delay: number
  duration: number
}) {
  // useId returns characters that are not valid in a url(#...) reference.
  const id = `beam${useId().replace(/[^\w-]/g, '')}`
  const reduced = useReducedMotion()
  const [path, setPath] = useState('')
  const [size, setSize] = useState({ width: 0, height: 0 })

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const update = () => {
      const from = fromRef.current
      const to = toRef.current
      if (!from || !to) return
      const box = container.getBoundingClientRect()
      const a = from.getBoundingClientRect()
      const b = to.getBoundingClientRect()
      setSize({ width: box.width, height: box.height })
      setPath(
        `M ${a.left - box.left + a.width / 2},${a.top - box.top + a.height / 2} ` +
          `L ${b.left - box.left + b.width / 2},${b.top - box.top + b.height / 2}`
      )
    }

    const observer = new ResizeObserver(update)
    observer.observe(container)
    update()
    return () => observer.disconnect()
  }, [containerRef, fromRef, toRef])

  return (
    <svg
      aria-hidden="true"
      fill="none"
      width={size.width}
      height={size.height}
      viewBox={`0 0 ${size.width} ${size.height}`}
      className="pointer-events-none absolute top-0 left-0"
    >
      <path d={path} strokeWidth={2} strokeLinecap="round" style={{ stroke: 'var(--border-strong)' }} />
      {reduced ? null : (
        <>
          <path d={path} strokeWidth={2} strokeLinecap="round" stroke={`url(#${id})`} />
          <defs>
            <motion.linearGradient
              id={id}
              gradientUnits="userSpaceOnUse"
              initial={{ x1: '0%', x2: '0%', y1: '0%', y2: '0%' }}
              animate={{ x1: ['10%', '110%'], x2: ['0%', '100%'], y1: ['0%', '0%'], y2: ['0%', '0%'] }}
              transition={{ delay, duration, ease: [0.16, 1, 0.3, 1], repeat: Infinity }}
            >
              <stop style={{ stopColor: 'var(--highlight)', stopOpacity: 0 }} />
              <stop style={{ stopColor: 'var(--highlight)' }} />
              <stop offset="32.5%" style={{ stopColor: 'var(--accent)' }} />
              <stop offset="100%" style={{ stopColor: 'var(--accent)', stopOpacity: 0 }} />
            </motion.linearGradient>
          </defs>
        </>
      )}
    </svg>
  )
}
