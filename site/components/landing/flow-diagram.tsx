'use client'

import { useRef, type RefObject } from 'react'
import Image from 'next/image'
import { Cloud, FolderCode, Package } from 'lucide-react'

import icon from '@/app/icon.png'
import { AnimatedBeam } from '@/components/ui/animated-beam'

/**
 * Where a deployment travels: from your project, through nextship on your machine,
 * into your own registry and onto App Platform. Every stop but the tool itself is
 * in your account, which is the point the picture makes.
 *
 * Author: Gowtham
 */
export function FlowDiagram() {
  const container = useRef<HTMLDivElement>(null)
  const project = useRef<HTMLDivElement>(null)
  const cli = useRef<HTMLDivElement>(null)
  const registry = useRef<HTMLDivElement>(null)
  const platform = useRef<HTMLDivElement>(null)

  return (
    <div ref={container} className="relative mx-auto flex max-w-4xl items-start justify-between gap-2 px-1 py-4">
      <Stop nodeRef={project} label="Your project" detail="a Next.js app">
        <FolderCode className="h-6 w-6 text-muted-strong" aria-hidden="true" />
      </Stop>
      <Stop nodeRef={cli} label="nextship" detail="builds in Docker" emphasis>
        <Image src={icon} alt="" className="h-9 w-9 rounded-lg" />
      </Stop>
      <Stop nodeRef={registry} label="Your registry" detail="DigitalOcean">
        <Package className="h-6 w-6 text-muted-strong" aria-hidden="true" />
      </Stop>
      <Stop nodeRef={platform} label="App Platform" detail="your account">
        <Cloud className="h-6 w-6 text-muted-strong" aria-hidden="true" />
      </Stop>

      <AnimatedBeam containerRef={container} fromRef={project} toRef={cli} delay={0} duration={3.2} />
      <AnimatedBeam containerRef={container} fromRef={cli} toRef={registry} delay={1} duration={3.2} />
      <AnimatedBeam containerRef={container} fromRef={registry} toRef={platform} delay={2} duration={3.2} />
    </div>
  )
}

function Stop({
  nodeRef,
  label,
  detail,
  emphasis = false,
  children,
}: {
  nodeRef: RefObject<HTMLDivElement | null>
  label: string
  detail: string
  emphasis?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="flex w-20 flex-col items-center text-center sm:w-32">
      <div
        ref={nodeRef}
        className={`relative z-10 grid h-16 w-16 place-items-center rounded-2xl border bg-card sm:h-20 sm:w-20 ${
          emphasis ? 'border-accent/40 shadow-[0_0_0_6px_var(--spotlight)]' : 'border-border'
        }`}
      >
        {children}
      </div>
      <p className="mt-3 text-sm font-semibold">{label}</p>
      <p className="mt-0.5 text-xs text-muted">{detail}</p>
    </div>
  )
}
