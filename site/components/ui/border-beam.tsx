'use client'

import { motion, type MotionStyle } from 'motion/react'

/**
 * A light that travels around the border of its parent, which must be positioned
 * and rounded for the beam to follow its edge.
 *
 * Adapted from Magic UI's BorderBeam, MIT License, Copyright (c) Magic UI; the licence
 * is in THIRD_PARTY_NOTICES.md. The beam runs from the brand yellow into the brand
 * blue, and it is left out for visitors who ask for reduced motion, since it never
 * stops moving.
 *
 * Author: Magic UI, adapted by Gowtham
 */
export function BorderBeam({ size, duration }: { size: number; duration: number }) {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 rounded-[inherit] border border-transparent mask-[linear-gradient(transparent,transparent),linear-gradient(#000,#000)] mask-intersect [mask-clip:padding-box,border-box] motion-reduce:hidden"
    >
      <motion.div
        className="absolute aspect-square bg-linear-to-l from-highlight via-accent to-transparent"
        style={{ width: size, offsetPath: `rect(0 auto auto 0 round ${size}px)` } as MotionStyle}
        initial={{ offsetDistance: '0%' }}
        animate={{ offsetDistance: ['0%', '100%'] }}
        transition={{ repeat: Infinity, ease: 'linear', duration }}
      />
    </div>
  )
}
