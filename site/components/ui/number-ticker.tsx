'use client'

import { useEffect, useRef } from 'react'
import { useInView, useMotionValue, useReducedMotion, useSpring } from 'motion/react'

/**
 * A number that counts up from zero when it scrolls into view.
 *
 * Adapted from Magic UI's NumberTicker, MIT License, Copyright (c) Magic UI; the
 * licence is in THIRD_PARTY_NOTICES.md. The original renders zero until JavaScript
 * runs; this one renders the real value, so the number is right with JavaScript off
 * and for anyone who asks for reduced motion. The count restarts from zero only once
 * the number is on screen.
 *
 * Author: Magic UI, adapted by Gowtham
 */
export function NumberTicker({ value, decimals }: { value: number; decimals: number }) {
  const ref = useRef<HTMLSpanElement>(null)
  const target = useMotionValue(0)
  const spring = useSpring(target, { damping: 60, stiffness: 100 })
  const inView = useInView(ref, { once: true })
  const reduced = useReducedMotion()

  useEffect(() => {
    const node = ref.current
    if (!node || !inView || reduced) return

    const format = (n: number) =>
      n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
    node.textContent = format(0)
    const unsubscribe = spring.on('change', (latest) => {
      node.textContent = format(latest)
    })
    target.set(value)
    return unsubscribe
  }, [inView, reduced, spring, target, value, decimals])

  return (
    <span ref={ref} className="tabular-nums">
      {value.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}
    </span>
  )
}
