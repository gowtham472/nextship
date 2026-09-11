import Link from 'next/link'
import {
  ArrowRight,
  Check,
  ClipboardList,
  Container,
  Info,
  KeyRound,
  Layers,
  PackageOpen,
  Rocket,
  ScanSearch,
  Scissors,
  ShieldCheck,
  SlidersHorizontal,
  Upload,
} from 'lucide-react'

import { CopyButton } from '@/components/copy-button'
import { FlowDiagram } from '@/components/landing/flow-diagram'
import { HeroBackground } from '@/components/landing/hero-background'
import { SpotlightCard } from '@/components/spotlight-card'
import { Terminal, type Line } from '@/components/terminal'
import { Marquee } from '@/components/ui/marquee'
import { NumberTicker } from '@/components/ui/number-ticker'

const INSTALL = 'npm install -g nextship-cli'

const HEADLINE = ['Deploy', 'Next.js', 'to', 'infrastructure', 'you', 'own']

/** Where the headline turns blue: the part that is the point. */
const HEADLINE_ACCENT_FROM = 4

const TRANSCRIPT: Line[] = [
  { kind: 'command', text: 'nextship deploy --yes' },
  { kind: 'blank' },
  { kind: 'output', text: '> Building app in Docker' },
  { kind: 'muted', text: '  deployment dpl-2b2c3e53' },
  { kind: 'muted', text: '  next 16.4.0, standalone off, adapter injected' },
  { kind: 'output', text: '> Pruning to what the build traced' },
  { kind: 'muted', text: '  1.13 GB -> 591 MB' },
  { kind: 'output', text: '> Pushing to registry.digitalocean.com' },
  { kind: 'output', text: '> Releasing, then waiting for it to serve' },
  { kind: 'blank' },
  { kind: 'success', text: 'v Live: https://preview.doodlebytestudio.in' },
]

const KEEPS_WORKING = [
  'Streaming',
  'Suspense',
  'Time-based ISR',
  'On-demand ISR',
  'Server Actions',
  'Image optimization',
  'after()',
]

const STATS = [
  {
    value: 94.3,
    decimals: 1,
    unit: '%',
    label: "of Next.js's own deploy-mode suites pass",
    detail: '1,051 of 1,115, reproduced across two runs',
  },
  {
    value: 591,
    decimals: 0,
    unit: 'MB',
    label: 'runtime image, from a 1.13 GB tree',
    detail: 'pruned to the files the build traced',
  },
  {
    value: 27,
    decimals: 0,
    unit: 'ms',
    label: 'to first byte while a page streams',
    detail: 'against a 2.02 s total, on a real container',
  },
]

const PIPELINE = [
  {
    step: '01',
    title: 'Detect',
    icon: ScanSearch,
    body: 'Reads the installed Next.js version, the package manager, the lockfile and the workspace layout. Nothing is guessed from a declared range.',
  },
  {
    step: '02',
    title: 'Build',
    icon: Container,
    body: 'Builds inside Docker with the official Deployment Adapter injected. Your machine compiles nothing and needs no toolchain.',
  },
  {
    step: '03',
    title: 'Prune',
    icon: Scissors,
    body: 'Keeps only the files the build traced as reachable. A 1.13 GB tree becomes 591 MB without a Dockerfile or a standalone flag.',
  },
  {
    step: '04',
    title: 'Push',
    icon: Upload,
    body: 'Pushes to a registry in your own account, with the credential written to a temporary config rather than a process argument.',
  },
  {
    step: '05',
    title: 'Release',
    icon: Rocket,
    body: 'Merges into the existing app spec so settings you set by hand survive, then waits for the deployment to actually serve traffic.',
  },
]

/** Six cards on three columns, wide and narrow alternating so the grid reads as a bento rather than a table. */
const FEATURES = [
  {
    title: 'Every Next.js feature keeps working',
    icon: Layers,
    span: 'lg:col-span-2',
    body: 'The container runs the Next.js server itself, not a reimplementation. Streaming, ISR, Server Actions, image optimization and after() all behave as they do in development.',
  },
  {
    title: 'A plan before anything changes',
    icon: ClipboardList,
    span: '',
    body: 'deploy, rollback and env rm each print what they will do and stop. Nothing is created, changed or charged until you pass --yes.',
  },
  {
    title: 'Nothing is ever deleted',
    icon: ShieldCheck,
    span: '',
    body: 'No command removes a cloud resource except destroy, which needs the app name and --yes. Rollback reuses an image that already ran, so it cannot introduce a new fault.',
  },
  {
    title: 'Secrets stay out of the image',
    icon: KeyRound,
    span: 'lg:col-span-2',
    body: 'Env files are mounted as BuildKit secrets, excluded from layers and from the cache key. The registry credential lives in a 0600 temp config that is removed afterwards.',
  },
  {
    title: 'Your settings survive a deploy',
    icon: SlidersHorizontal,
    span: 'lg:col-span-2',
    body: 'App Platform replaces the whole spec on update, so nextship merges rather than overwrites. Ingress rules, hand-added components and console-set variables are all preserved.',
  },
  {
    title: 'No lock-in, by construction',
    icon: PackageOpen,
    span: '',
    body: 'The output is an OCI image in your registry. If nextship disappears tomorrow, the image still runs anywhere that runs containers.',
  },
]

const LEAVING = [
  { area: 'Streaming and Suspense', state: 'Works. 27 ms to first byte against a 2.02 s total, measured on a real container.' },
  { area: 'ISR, time based and on demand', state: 'Works. Verified against a live deployment.' },
  { area: 'Server Actions', state: 'Works. One encryption key is pinned across builds so actions stay decryptable.' },
  { area: 'Image optimization', state: 'Works, producing WebP. sharp is installed for the container platform, not yours.' },
  { area: 'Edge runtime', state: 'Runs on Node instead. There is no edge tier in your own account to run it on.' },
  { area: 'Analytics and Speed Insights', state: 'Not available. Those are Vercel products, not Next.js features.' },
]

/** An entrance delay for the hero's staged animation, read by .fade-up in globals.css. */
function delay(ms: number): React.CSSProperties {
  return { '--delay': `${ms}ms` } as React.CSSProperties
}

export default function HomePage() {
  return (
    <>
      <section className="relative isolate overflow-hidden border-b border-border">
        <div className="hero-glow -z-10" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div className="grid-backdrop pointer-events-none absolute inset-0 -z-10" aria-hidden="true" />
        <HeroBackground />

        <div className="mx-auto max-w-6xl px-5 pt-20 pb-24 text-center sm:px-8 sm:pt-28">
          <h1 className="mx-auto max-w-4xl text-display leading-[1.02] font-extrabold tracking-[-0.035em] text-balance">
            {HEADLINE.map((word, index) => (
              <span key={word}>
                <span
                  className={`rise-word ${index >= HEADLINE_ACCENT_FROM ? 'text-accent-text' : ''}`}
                  style={{ '--i': index } as React.CSSProperties}
                >
                  {word}
                </span>{' '}
              </span>
            ))}
            {/* The full stop is the square from the dot of the wordmark's i. */}
            <span
              className="rise-word -ml-[0.2em] h-[0.17em] w-[0.17em] bg-highlight"
              style={{ '--i': HEADLINE.length } as React.CSSProperties}
              aria-hidden="true"
            />
          </h1>

          <p
            className="fade-up mx-auto mt-7 max-w-2xl text-lg leading-relaxed text-muted text-pretty sm:text-xl"
            style={delay(650)}
          >
            No Dockerfile. No <code className="font-mono text-[0.9em] text-muted-strong">next.config</code> edits. No
            Terraform, and no IAM archaeology. One command builds your app, prunes it to what it actually needs, and puts
            it on your own cloud account.
          </p>

          <div className="fade-up mt-10 flex flex-wrap items-center justify-center gap-3" style={delay(800)}>
            <Link
              href="/docs/quick-start"
              className="sheen inline-flex h-12 items-center gap-2 rounded-full bg-accent px-6 text-sm font-semibold text-accent-foreground shadow-[0_10px_30px_-10px_rgba(0,94,255,0.7)] transition-transform hover:-translate-y-0.5"
            >
              Get started
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
            <Link
              href="/docs"
              className="inline-flex h-12 items-center rounded-full border border-border-strong bg-background/60 px-6 text-sm font-semibold backdrop-blur transition-colors hover:bg-card-hover"
            >
              Read the docs
            </Link>
          </div>

          <div className="fade-up mt-5 flex justify-center" style={delay(900)}>
            <div className="flex h-10 items-center gap-2 rounded-full border border-border bg-card/70 pr-1.5 pl-4 backdrop-blur">
              <span className="font-mono text-xs text-accent-text select-none">$</span>
              <code className="font-mono text-sm text-muted-strong">{INSTALL}</code>
              <CopyButton value={INSTALL} label={`Copy the install command: ${INSTALL}`} />
            </div>
          </div>

          <div className="fade-up mx-auto mt-16 max-w-3xl" style={delay(1000)}>
            <Terminal title="your-nextjs-app" lines={TRANSCRIPT} />
          </div>
        </div>
      </section>

      <section className="border-b border-border bg-background-subtle/60 py-10">
        <p className="px-5 text-center text-sm text-muted">
          The container runs the Next.js server itself, so all of this keeps working
        </p>
        <div className="mt-6 [mask-image:linear-gradient(to_right,transparent,#000_12%,#000_88%,transparent)]">
          <Marquee copies={4}>
            {KEEPS_WORKING.map((feature) => (
              <span
                key={feature}
                className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm font-medium whitespace-nowrap text-muted-strong"
              >
                <Check className="h-3.5 w-3.5 text-accent-text" aria-hidden="true" />
                {feature}
              </span>
            ))}
          </Marquee>
        </div>
      </section>

      <section className="border-b border-border">
        <div className="reveal mx-auto grid max-w-6xl divide-y divide-border px-5 py-10 sm:grid-cols-3 sm:divide-x sm:divide-y-0 sm:px-8">
          {STATS.map((stat) => (
            <div key={stat.unit} className="px-4 py-8 text-center">
              <p className="text-5xl font-extrabold tracking-tight sm:text-6xl">
                <NumberTicker value={stat.value} decimals={stat.decimals} />
                <span className="ml-1 text-2xl font-bold text-accent-text sm:text-3xl">{stat.unit}</span>
              </p>
              <p className="mt-3 font-semibold">{stat.label}</p>
              <p className="mt-1 text-sm text-muted">{stat.detail}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="border-b border-border">
        <div className="mx-auto max-w-6xl px-5 py-24 sm:px-8">
          <SectionHeading
            eyebrow="How it works"
            title="What that one command does"
            body="Five steps, each of which you can run on its own. Nothing is hidden behind a service you cannot inspect."
          />

          <div className="reveal mt-14">
            <FlowDiagram />
          </div>

          <ol className="reveal mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {PIPELINE.map((item) => (
              <li
                key={item.step}
                className="rounded-2xl border border-border bg-card p-5 transition-colors hover:border-border-strong"
              >
                <div className="flex items-center justify-between">
                  <span className="grid h-9 w-9 place-items-center rounded-xl bg-accent/10 text-accent-text">
                    <item.icon className="h-[18px] w-[18px]" aria-hidden="true" />
                  </span>
                  <span className="font-mono text-xs text-muted">{item.step}</span>
                </div>
                <h3 className="mt-4 font-semibold">{item.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{item.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="border-b border-border bg-background-subtle/50">
        <div className="mx-auto max-w-6xl px-5 py-24 sm:px-8">
          <SectionHeading
            eyebrow="Guarantees"
            title="What is in nextship"
            body="The guarantees the tool is built around, rather than a list of features."
          />

          <div className="mt-14 grid gap-4 lg:grid-cols-3">
            {FEATURES.map((feature) => (
              <SpotlightCard
                key={feature.title}
                className={`reveal rounded-2xl border border-border bg-card p-7 transition-colors hover:border-border-strong ${feature.span}`}
              >
                <span className="grid h-11 w-11 place-items-center rounded-xl border border-border bg-background text-accent-text">
                  <feature.icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <h3 className="mt-5 text-lg font-semibold tracking-tight">{feature.title}</h3>
                <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted">{feature.body}</p>
              </SpotlightCard>
            ))}
          </div>
        </div>
      </section>

      <section className="border-b border-border">
        <div className="mx-auto max-w-4xl px-5 py-24 sm:px-8">
          <SectionHeading
            eyebrow="Leaving Vercel"
            title="What changes when you leave Vercel"
            body={
              <>
                Stated plainly, including the parts that do not survive the move. Run{' '}
                <code className="font-mono text-[0.9em] text-muted-strong">nextship doctor</code> to get this for your own
                project.
              </>
            }
          />

          <ul className="reveal mt-12 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
            {LEAVING.map((row) => {
              const works = row.state.startsWith('Works')
              return (
                <li key={row.area} className="flex gap-4 p-5 sm:p-6">
                  <span
                    className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full ${
                      works ? 'bg-accent/10 text-accent-text' : 'bg-highlight/20 text-highlight-text'
                    }`}
                  >
                    {works ? (
                      <Check className="h-4 w-4" aria-label="Works" />
                    ) : (
                      <Info className="h-4 w-4" aria-label="Changes" />
                    )}
                  </span>
                  <div>
                    <p className="font-semibold">{row.area}</p>
                    <p className="mt-1 text-sm leading-relaxed text-muted">{row.state}</p>
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      </section>

      <section>
        <div className="mx-auto max-w-6xl px-5 py-24 sm:px-8">
          {/* Brand blue in both themes: this card is the one place the page commits to the colour. */}
          <div className="reveal relative isolate overflow-hidden rounded-3xl bg-accent px-6 py-16 text-center text-white shadow-[0_30px_90px_-40px_rgba(0,94,255,0.8)] sm:px-16">
            <div
              aria-hidden="true"
              className="absolute inset-0 -z-10 bg-[radial-gradient(rgb(255_255_255/0.2)_1px,transparent_1px)] [background-size:18px_18px] [mask-image:radial-gradient(ellipse_at_center,#000_30%,transparent_75%)]"
            />
            <div
              aria-hidden="true"
              className="absolute -top-28 left-1/2 -z-10 h-64 w-[36rem] -translate-x-1/2 rounded-full bg-highlight/30 blur-3xl"
            />
            <h2 className="text-title font-extrabold tracking-[-0.03em] text-balance">Deploy your first app</h2>
            <p className="mx-auto mt-4 max-w-xl text-lg text-white/80 text-pretty">
              You need Node 22, a running Docker, and a DigitalOcean token. The local commands need nothing but the first
              two.
            </p>
            <div className="mt-9 flex flex-wrap justify-center gap-3">
              <Link
                href="/docs/quick-start"
                className="inline-flex h-12 items-center gap-2 rounded-full bg-white px-6 text-sm font-semibold text-[#003fb0] transition-transform hover:-translate-y-0.5"
              >
                Quick start
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
              <Link
                href="/docs/commands"
                className="inline-flex h-12 items-center rounded-full border border-white/35 px-6 text-sm font-semibold text-white transition-colors hover:bg-white/10"
              >
                CLI reference
              </Link>
            </div>
          </div>
        </div>
      </section>
    </>
  )
}

function SectionHeading({ eyebrow, title, body }: { eyebrow: string; title: string; body: React.ReactNode }) {
  return (
    <div className="reveal mx-auto max-w-2xl text-center">
      <p className="inline-flex items-center gap-2 text-sm font-semibold text-accent-text">
        <span className="h-1.5 w-1.5 bg-highlight" aria-hidden="true" />
        {eyebrow}
      </p>
      <h2 className="mt-3 text-title font-extrabold tracking-[-0.03em] text-balance">{title}</h2>
      <p className="mt-4 text-lg text-muted text-pretty">{body}</p>
    </div>
  )
}
