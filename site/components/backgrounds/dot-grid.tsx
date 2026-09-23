'use client'

/**
 * DotGrid, from React Bits (https://reactbits.dev/backgrounds/dot-grid). Copyright (c)
 * 2026 David Haz.
 *
 * This file is under the React Bits licence, MIT with the Commons Clause, not the
 * Apache-2.0 licence of the rest of this repository: it may be used and changed as
 * part of this website, but the component itself may not be sold or redistributed
 * on its own. The full licence is in THIRD_PARTY_NOTICES.md.
 *
 * Changed from upstream in three ways. The dots move on a small damped spring instead
 * of GSAP's inertia plugin, which kept the elastic return without adding a dependency
 * that is not open source. Drawing stops while the grid is off screen, where upstream
 * redrew every frame for as long as the page was open. And a dot's pull toward the
 * pointer is bounded, so a fast sweep ripples the grid rather than flinging dots across
 * the headline.
 */

import { useEffect, useRef } from 'react'

interface Dot {
  cx: number
  cy: number
  x: number
  y: number
  vx: number
  vy: number
}

export interface DotGridProps {
  dotSize: number
  gap: number
  /** Hex colours, `#rrggbb`: the resting dot, and the dot under the pointer. */
  baseColor: string
  activeColor: string
  /** How far from the pointer, in pixels, dots light up and can be pushed. */
  proximity: number
  /** Pointer speed, in pixels a second, above which passing dots are pushed. */
  speedTrigger: number
  shockRadius: number
  className?: string
}

/** Spring stiffness and damping. Underdamped, so a dot overshoots once and settles. */
const STIFFNESS = 90
const DAMPING = 9
/** The largest speed, in pixels a second, a push gives a dot. */
const MAX_KICK = 220
const REST = 0.05

function rgb(hex: string): [number, number, number] {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  if (!match) throw new Error(`DotGrid needs a #rrggbb colour, not "${hex}".`)
  return [parseInt(match[1] ?? '0', 16), parseInt(match[2] ?? '0', 16), parseInt(match[3] ?? '0', 16)]
}

export function DotGrid({ dotSize, gap, baseColor, activeColor, proximity, speedTrigger, shockRadius, className }: DotGridProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    const base = rgb(baseColor)
    const active = rgb(activeColor)
    const pointer = { x: -1e4, y: -1e4, lastX: 0, lastY: 0, lastTime: 0 }
    let dots: Dot[] = []
    let frame = 0
    let visible = false
    let previous = 0

    const build = () => {
      const { width, height } = canvas.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

      const cell = dotSize + gap
      const cols = Math.floor((width + gap) / cell)
      const rows = Math.floor((height + gap) / cell)
      const startX = (width - (cell * cols - gap)) / 2 + dotSize / 2
      const startY = (height - (cell * rows - gap)) / 2 + dotSize / 2
      dots = []
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const cx = startX + col * cell
          const cy = startY + row * cell
          dots.push({ cx, cy, x: 0, y: 0, vx: 0, vy: 0 })
        }
      }
    }

    const kick = (dot: Dot, fromX: number, fromY: number, strength: number) => {
      const dx = dot.cx - fromX
      const dy = dot.cy - fromY
      const length = Math.hypot(dx, dy) || 1
      dot.vx += (dx / length) * MAX_KICK * strength
      dot.vy += (dy / length) * MAX_KICK * strength
    }

    const draw = (time: number) => {
      const dt = Math.min((time - (previous || time)) / 1000, 1 / 30)
      previous = time
      const { width, height } = canvas.getBoundingClientRect()
      ctx.clearRect(0, 0, width, height)

      const radius = dotSize / 2
      for (const dot of dots) {
        if (dot.x !== 0 || dot.y !== 0 || dot.vx !== 0 || dot.vy !== 0) {
          dot.vx += (-STIFFNESS * dot.x - DAMPING * dot.vx) * dt
          dot.vy += (-STIFFNESS * dot.y - DAMPING * dot.vy) * dt
          dot.x += dot.vx * dt
          dot.y += dot.vy * dt
          if (Math.abs(dot.x) + Math.abs(dot.y) < REST && Math.abs(dot.vx) + Math.abs(dot.vy) < REST) {
            dot.x = dot.y = dot.vx = dot.vy = 0
          }
        }

        const distance = Math.hypot(dot.cx - pointer.x, dot.cy - pointer.y)
        const t = distance < proximity ? 1 - distance / proximity : 0
        ctx.fillStyle =
          t === 0
            ? baseColor
            : `rgb(${base.map((channel, index) => Math.round(channel + ((active[index] ?? channel) - channel) * t)).join(',')})`
        ctx.beginPath()
        ctx.arc(dot.cx + dot.x, dot.cy + dot.y, radius, 0, Math.PI * 2)
        ctx.fill()
      }

      frame = visible ? requestAnimationFrame(draw) : 0
    }

    const start = () => {
      if (frame === 0) {
        previous = 0
        frame = requestAnimationFrame(draw)
      }
    }

    const onMove = (event: PointerEvent) => {
      const now = performance.now()
      const elapsed = pointer.lastTime ? now - pointer.lastTime : 16
      const speed = (Math.hypot(event.clientX - pointer.lastX, event.clientY - pointer.lastY) / elapsed) * 1000
      pointer.lastTime = now
      pointer.lastX = event.clientX
      pointer.lastY = event.clientY

      const rect = canvas.getBoundingClientRect()
      pointer.x = event.clientX - rect.left
      pointer.y = event.clientY - rect.top
      if (speed < speedTrigger) return
      const strength = Math.min(speed / (speedTrigger * 8), 1) * 0.6
      for (const dot of dots) {
        const distance = Math.hypot(dot.cx - pointer.x, dot.cy - pointer.y)
        if (distance < proximity) kick(dot, pointer.x, pointer.y, strength * (1 - distance / proximity))
      }
    }

    const onLeave = () => {
      pointer.x = pointer.y = -1e4
    }

    const onClick = (event: MouseEvent) => {
      const rect = canvas.getBoundingClientRect()
      const x = event.clientX - rect.left
      const y = event.clientY - rect.top
      for (const dot of dots) {
        const distance = Math.hypot(dot.cx - x, dot.cy - y)
        if (distance < shockRadius) kick(dot, x, y, 1 - distance / shockRadius)
      }
    }

    build()
    const resize = new ResizeObserver(build)
    resize.observe(canvas)
    const viewport = new IntersectionObserver((entries) => {
      visible = entries.some((entry) => entry.isIntersecting)
      if (visible) start()
    })
    viewport.observe(canvas)
    window.addEventListener('pointermove', onMove, { passive: true })
    document.documentElement.addEventListener('pointerleave', onLeave)
    window.addEventListener('click', onClick)

    return () => {
      cancelAnimationFrame(frame)
      resize.disconnect()
      viewport.disconnect()
      window.removeEventListener('pointermove', onMove)
      document.documentElement.removeEventListener('pointerleave', onLeave)
      window.removeEventListener('click', onClick)
    }
  }, [dotSize, gap, baseColor, activeColor, proximity, speedTrigger, shockRadius])

  return <canvas ref={canvasRef} className={`block h-full w-full ${className ?? ''}`} />
}
