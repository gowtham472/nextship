'use client'

import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useInView, useReducedMotion } from 'motion/react'
import { Check, Container, KeyRound, Lock, Rocket, ScanSearch, Scissors, Upload, type LucideIcon } from 'lucide-react'

/**
 * The five steps of a deployment as a build line: a row of steps on a rail, and a
 * stage that shows what the selected step does to your app.
 *
 * It plays through the steps on its own while it is on screen, and stops for good
 * the moment a visitor picks one, since at that point they are reading. Hovering or
 * focusing it pauses the play. Visitors who ask for reduced motion get no play and
 * no animation. Every step's panel is in the page, so the text does not depend on
 * JavaScript to exist.
 *
 * The scenes use the example project from the README's command reference, so every
 * value in them is one nextship actually prints.
 *
 * Author: Gowtham
 */
const STEPS: Array<{ title: string; icon: LucideIcon; body: string; Scene: () => React.ReactNode }> = [
  {
    title: 'Detect',
    icon: ScanSearch,
    body: 'Reads the installed Next.js version, the package manager, the lockfile and the workspace layout. Nothing is guessed from a declared range.',
    Scene: DetectScene,
  },
  {
    title: 'Build',
    icon: Container,
    body: 'Builds inside Docker with the official Deployment Adapter injected. Your machine compiles nothing and needs no toolchain.',
    Scene: BuildScene,
  },
  {
    title: 'Prune',
    icon: Scissors,
    body: 'Keeps only the files the build traced as reachable. A 1.13 GB tree becomes 591 MB without a Dockerfile or a standalone flag.',
    Scene: PruneScene,
  },
  {
    title: 'Push',
    icon: Upload,
    body: 'Pushes to a registry in your own account, with the credential written to a temporary config rather than a process argument.',
    Scene: PushScene,
  },
  {
    title: 'Release',
    icon: Rocket,
    body: 'Merges into the existing app spec so settings you set by hand survive, then waits for the deployment to actually serve traffic.',
    Scene: ReleaseScene,
  },
]

/** How long a step stays on the stage while the line plays by itself. */
const STEP_MS = 5600

export function Pipeline() {
  const root = useRef<HTMLDivElement>(null)
  const tabs = useRef<Array<HTMLButtonElement | null>>([])
  const [active, setActive] = useState(0)
  const [held, setHeld] = useState(false)
  const [chosen, setChosen] = useState(false)
  const onScreen = useInView(root, { amount: 0.35 })
  const reduced = useReducedMotion()
  const playing = !reduced && onScreen && !held && !chosen

  useEffect(() => {
    if (!playing) return
    const timer = window.setTimeout(() => setActive((step) => (step + 1) % STEPS.length), STEP_MS)
    return () => window.clearTimeout(timer)
  }, [playing, active])

  const choose = (step: number) => {
    setChosen(true)
    setActive(step)
  }

  // Arrow keys move along the line, as a tab list does.
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const moves: Partial<Record<string, number>> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }
    const jumps: Partial<Record<string, number>> = { Home: 0, End: STEPS.length - 1 }
    const move = moves[event.key]
    const next = move === undefined ? jumps[event.key] : (active + move + STEPS.length) % STEPS.length
    if (next === undefined) return
    event.preventDefault()
    choose(next)
    tabs.current[next]?.focus()
  }

  return (
    <div
      ref={root}
      onPointerEnter={() => setHeld(true)}
      onPointerLeave={() => setHeld(false)}
      onFocusCapture={() => setHeld(true)}
      onBlurCapture={() => setHeld(false)}
    >
      <div className="relative">
        {/* The rail the steps sit on, filled as far as the step on the stage. */}
        <div aria-hidden="true" className="absolute inset-x-8 top-1/2 hidden h-0.5 -translate-y-1/2 rounded-full bg-border sm:block">
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-700 ease-out"
            style={{ width: `${(active / (STEPS.length - 1)) * 100}%` }}
          />
        </div>
        <div role="tablist" aria-label="Deployment steps" className="relative grid grid-cols-5 gap-2 sm:gap-4">
          {STEPS.map((step, index) => {
            const selected = index === active
            return (
              <button
                key={step.title}
                ref={(element) => {
                  tabs.current[index] = element
                }}
                type="button"
                role="tab"
                id={`pipeline-tab-${index}`}
                aria-selected={selected}
                aria-controls={`pipeline-panel-${index}`}
                tabIndex={selected ? 0 : -1}
                onClick={() => choose(index)}
                onKeyDown={onKeyDown}
                className={`relative flex flex-col items-center gap-2 overflow-hidden rounded-2xl px-1 py-3 text-center transition-[background-color,transform] outline-none hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:flex-row sm:gap-3 sm:px-4 sm:py-4 sm:text-left ${
                  selected
                    ? 'bg-accent text-accent-foreground shadow-[0_10px_30px_-10px_rgba(0,94,255,0.7)]'
                    : 'bg-card ring-1 ring-border hover:bg-card-hover'
                }`}
              >
                <span
                  className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${
                    selected ? 'bg-white/15' : 'bg-accent/10 text-accent-text'
                  }`}
                >
                  <step.icon className="h-[18px] w-[18px]" aria-hidden="true" />
                </span>
                <span className="min-w-0">
                  <span className={`hidden font-mono text-xs sm:block ${selected ? 'text-white/70' : 'text-muted'}`}>
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <span className="block text-[11px] font-semibold sm:text-base">{step.title}</span>
                </span>
                {selected && playing ? (
                  <span
                    key={active}
                    aria-hidden="true"
                    className="pipeline-progress absolute inset-x-3 bottom-1.5 h-[3px] origin-left rounded-full bg-highlight"
                    style={{ animationDuration: `${STEP_MS}ms` }}
                  />
                ) : null}
              </button>
            )
          })}
        </div>
      </div>

      {STEPS.map((step, index) => (
        <div
          key={step.title}
          role="tabpanel"
          id={`pipeline-panel-${index}`}
          aria-labelledby={`pipeline-tab-${index}`}
          hidden={index !== active}
          className="mt-6 grid gap-8 rounded-2xl border border-border bg-card p-6 sm:mt-8 sm:p-9 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-center"
        >
          <div>
            <p className="font-mono text-sm text-accent-text">Step {String(index + 1).padStart(2, '0')} of 05</p>
            <h3 className="mt-2 text-3xl font-extrabold tracking-[-0.03em] sm:text-4xl">{step.title}</h3>
            <p className="mt-4 max-w-md text-base leading-relaxed text-muted text-pretty">{step.body}</p>
          </div>
          <div className="min-h-64 rounded-xl border border-border bg-background-subtle p-5 sm:p-7">
            <step.Scene />
          </div>
        </div>
      ))}
    </div>
  )
}

/** Staggers a scene's entrance, read by the .pipeline-in rule in globals.css. */
function at(order: number): React.CSSProperties {
  return { '--n': order } as React.CSSProperties
}

function DetectScene() {
  const rows = [
    ['package mgr', 'pnpm'],
    ['build command', 'pnpm run build'],
    ['node', '24'],
    ['sharp', '0.34.5'],
    ['env files', 'none'],
  ]
  return (
    <div className="relative overflow-hidden font-mono text-xs leading-7 sm:text-sm">
      <span aria-hidden="true" className="pipeline-scan pointer-events-none absolute inset-x-0 top-0 h-10" />
      <p className="pipeline-in text-muted" style={at(0)}>
        <span className="text-accent-text">&gt;</span> nextship detect
      </p>
      <p className="pipeline-in mt-1 flex items-start gap-2 font-semibold" style={at(1)}>
        <Check className="mt-1.5 h-4 w-4 shrink-0 text-accent-text" aria-hidden="true" />
        acme-web is a Next.js 16.2.9 project
      </p>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 pl-6 sm:gap-x-6">
        {rows.map(([key, value], index) => (
          <div key={key} className="contents">
            <dt className="pipeline-in text-muted" style={at(index + 2)}>
              {key}
            </dt>
            <dd className="pipeline-in text-muted-strong" style={at(index + 2)}>
              {value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

function BuildScene() {
  const layers = ['FROM node:24-slim', 'install from your lockfile', 'your build script, adapter injected', 'manifest.json exported']
  return (
    <div className="flex h-full flex-col justify-center gap-5 sm:flex-row sm:items-center sm:gap-8">
      <ol className="flex flex-1 flex-col-reverse gap-2">
        {layers.map((layer, index) => (
          <li
            key={layer}
            className={`pipeline-drop rounded-lg px-4 py-2.5 font-mono text-[12px] sm:text-[13px] ${
              index === layers.length - 1
                ? 'bg-accent text-accent-foreground shadow-[0_10px_30px_-12px_rgba(0,94,255,0.7)]'
                : 'border border-border bg-card text-muted-strong'
            }`}
            style={at(index)}
          >
            {layer}
          </li>
        ))}
      </ol>
      <div className="pipeline-in flex shrink-0 flex-col items-start gap-2 text-sm sm:w-40" style={at(5)}>
        <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 font-semibold">
          <Container className="h-4 w-4 text-accent-text" aria-hidden="true" />
          Docker
        </span>
        <span className="text-muted">Your machine compiles nothing.</span>
      </div>
    </div>
  )
}

function PruneScene() {
  // 591 MB of a 1.13 GB tree, which is how much of the bar survives.
  const kept = 591 / 1130
  const tiles = Array.from({ length: 48 }, (_, index) => (index * 7) % 23 < 12)
  return (
    <div>
      <div className="grid grid-cols-12 gap-1.5">
        {tiles.map((traced, index) => (
          <span
            key={index}
            aria-hidden="true"
            className={`aspect-square rounded-[5px] ${traced ? 'pipeline-in bg-accent' : 'pipeline-fade bg-border-strong'}`}
            style={at(index % 12)}
          />
        ))}
      </div>
      <div className="mt-6 space-y-3 font-mono text-[13px]">
        <div className="flex items-center gap-3">
          <span className="w-28 shrink-0 text-muted">traced tree</span>
          <span className="h-2.5 flex-1 rounded-full bg-border" />
          <span className="w-16 text-right text-muted-strong">1.13 GB</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="w-28 shrink-0 text-muted">runtime image</span>
          <span className="relative h-2.5 flex-1">
            <span
              className="pipeline-shrink absolute inset-y-0 left-0 rounded-full bg-accent"
              style={{ '--kept': `${kept * 100}%` } as React.CSSProperties}
            />
          </span>
          <span className="w-16 text-right font-semibold text-accent-text">591 MB</span>
        </div>
      </div>
    </div>
  )
}

function PushScene() {
  return (
    <div className="flex h-full flex-col justify-center">
      <div className="pipeline-slide flex min-w-0 items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
        <Container className="h-5 w-5 shrink-0 text-accent-text" aria-hidden="true" />
        <span className="truncate font-mono text-[12px] text-muted-strong sm:text-[13px]">
          acme-web:dpl-2b2c3e535f1e-4456a8b2
        </span>
      </div>
      <div aria-hidden="true" className="pipeline-in flex flex-col items-center py-2" style={at(2)}>
        <span className="h-3 w-px bg-border-strong" />
        <span className="grid h-8 w-8 place-items-center rounded-full bg-accent text-accent-foreground">
          <Upload className="h-4 w-4" />
        </span>
        <span className="h-3 w-px bg-border-strong" />
      </div>
      <div className="pipeline-in rounded-xl border border-border bg-card px-4 py-4" style={at(3)}>
        <p className="font-mono text-[12px] text-muted">registry.digitalocean.com/</p>
        <p className="font-mono text-base font-semibold">acme-registry/acme-web</p>
      </div>
      <p className="pipeline-in mt-5 flex items-center gap-2 text-sm text-muted" style={at(4)}>
        <KeyRound className="h-4 w-4 shrink-0 text-highlight-text" aria-hidden="true" />
        The credential sits in a temporary config at mode 0600, then is removed.
      </p>
    </div>
  )
}

function ReleaseScene() {
  const kept = ['ingress', 'domains', 'env vars']
  return (
    <div className="flex h-full flex-col justify-center gap-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="pipeline-in rounded-xl border border-border bg-card p-4" style={at(0)}>
          <p className="text-xs font-semibold text-muted">Set by you</p>
          <ul className="mt-2 space-y-1.5 font-mono text-[13px]">
            {kept.map((field) => (
              <li key={field} className="flex items-center gap-2 text-muted-strong">
                <Lock className="h-3.5 w-3.5 text-muted" aria-hidden="true" />
                {field}
              </li>
            ))}
          </ul>
        </div>
        <div className="pipeline-in rounded-xl border border-border bg-card p-4" style={at(1)}>
          <p className="text-xs font-semibold text-muted">Set by nextship</p>
          <ul className="mt-2 space-y-1.5 font-mono text-[13px] text-accent-text">
            <li>image tag</li>
            <li>instance</li>
            <li>health check</li>
          </ul>
        </div>
      </div>
      <div
        className="pipeline-in flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3"
        style={at(3)}
      >
        <span className="truncate font-mono text-[13px] text-muted-strong">acme-web-a1b2c.ondigitalocean.app</span>
        <span className="inline-flex shrink-0 items-center gap-2 text-sm font-semibold">
          <span aria-hidden="true" className="pipeline-live relative h-2.5 w-2.5 rounded-full bg-accent" />
          serving
        </span>
      </div>
    </div>
  )
}
