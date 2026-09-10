import Link from 'next/link'

import { ArrowIcon } from '@/components/brand'
import { CopyButton } from '@/components/copy-button'
import { Terminal, type Line } from '@/components/terminal'

const INSTALL = 'npm install -g nextship-cli'

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

const PIPELINE = [
  {
    step: '01',
    title: 'Detect',
    body: 'Reads the installed Next.js version, the package manager, the lockfile and the workspace layout. Nothing is guessed from a declared range.',
  },
  {
    step: '02',
    title: 'Build',
    body: 'Builds inside Docker with the official Deployment Adapter injected. Your machine compiles nothing and needs no toolchain.',
  },
  {
    step: '03',
    title: 'Prune',
    body: 'Keeps only the files the build traced as reachable. A 1.13 GB tree becomes 591 MB without a Dockerfile or a standalone flag.',
  },
  {
    step: '04',
    title: 'Push',
    body: 'Pushes to a registry in your own account, with the credential written to a temporary config rather than a process argument.',
  },
  {
    step: '05',
    title: 'Release',
    body: 'Merges into the existing app spec so settings you set by hand survive, then waits for the deployment to actually serve traffic.',
  },
]

const FEATURES = [
  {
    title: 'Every Next.js feature keeps working',
    body: 'The container runs the Next.js server itself, not a reimplementation. Streaming, ISR, Server Actions, image optimization and after() all behave as they do in development.',
  },
  {
    title: 'A plan before anything changes',
    body: 'deploy, rollback and env rm each print what they will do and stop. Nothing is created, changed or charged until you pass --yes.',
  },
  {
    title: 'Nothing is ever deleted',
    body: 'No command removes a cloud resource except destroy, which needs the app name and --yes. Rollback reuses an image that already ran, so it cannot introduce a new fault.',
  },
  {
    title: 'Secrets stay out of the image',
    body: 'Env files are mounted as BuildKit secrets, excluded from layers and from the cache key. The registry credential lives in a 0600 temp config that is removed afterwards.',
  },
  {
    title: 'Your settings survive a deploy',
    body: 'App Platform replaces the whole spec on update, so nextship merges rather than overwrites. Ingress rules, hand-added components and console-set variables are all preserved.',
  },
  {
    title: 'No lock-in, by construction',
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

export default function HomePage() {
  return (
    <>
      <section className="relative overflow-hidden border-b border-border">
        <div className="grid-backdrop pointer-events-none absolute inset-0" aria-hidden="true" />

        <div className="relative mx-auto max-w-6xl px-5 py-24 sm:px-8 sm:py-32">
          <Link
            href="/docs/how-it-works"
            className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs text-muted transition-colors hover:text-foreground"
          >
            Built on the stable Next.js Deployment Adapter API
            <ArrowIcon className="h-3 w-3" />
          </Link>

          <h1 className="mt-6 max-w-4xl text-display font-semibold leading-[1.05] tracking-tight text-balance">
            Deploy Next.js to infrastructure you own
          </h1>

          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-muted text-pretty">
            No Dockerfile. No <code className="font-mono text-[0.9em] text-muted-strong">next.config</code> edits. No
            Terraform, and no IAM archaeology. One command builds your app, prunes it to what it actually needs, and puts
            it on your own cloud account.
          </p>

          <div className="mt-9 flex flex-wrap items-center gap-3">
            <Link
              href="/docs/quick-start"
              className="inline-flex h-11 items-center gap-2 rounded-lg bg-accent px-5 text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90"
            >
              Get started
              <ArrowIcon className="h-4 w-4" />
            </Link>
            <Link
              href="/docs"
              className="inline-flex h-11 items-center rounded-lg border border-border px-5 text-sm font-medium transition-colors hover:bg-card-hover"
            >
              Read the docs
            </Link>

            <div className="flex h-11 items-center gap-1 rounded-lg border border-border bg-card pl-4 pr-1.5">
              <code className="font-mono text-sm text-muted-strong">{INSTALL}</code>
              <CopyButton value={INSTALL} />
            </div>
          </div>

          <div className="mt-16 max-w-3xl">
            <Terminal title="your-nextjs-app" lines={TRANSCRIPT} />
          </div>
        </div>
      </section>

      <section className="border-b border-border">
        <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8 sm:py-24">
          <h2 className="text-title font-semibold tracking-tight text-balance">What that one command does</h2>
          <p className="mt-4 max-w-2xl text-muted text-pretty">
            Five steps, each of which you can run on its own. Nothing is hidden behind a service you cannot inspect.
          </p>

          <ol className="mt-12 grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-5">
            {PIPELINE.map((item) => (
              <li key={item.step} className="bg-card p-6 transition-colors hover:bg-card-hover">
                <span className="font-mono text-xs text-muted">{item.step}</span>
                <h3 className="mt-3 font-medium">{item.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{item.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="border-b border-border">
        <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8 sm:py-24">
          <h2 className="text-title font-semibold tracking-tight text-balance">What is in nextship</h2>
          <p className="mt-4 max-w-2xl text-muted text-pretty">
            The guarantees the tool is built around, rather than a list of features.
          </p>

          <div className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((feature) => (
              <article
                key={feature.title}
                className="rounded-xl border border-border bg-card p-6 transition-colors hover:bg-card-hover"
              >
                <h3 className="font-medium leading-snug">{feature.title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-muted">{feature.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="border-b border-border">
        <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8 sm:py-24">
          <h2 className="text-title font-semibold tracking-tight text-balance">
            What changes when you leave Vercel
          </h2>
          <p className="mt-4 max-w-2xl text-muted text-pretty">
            Stated plainly, including the parts that do not survive the move. Run{' '}
            <code className="font-mono text-[0.9em] text-muted-strong">nextship doctor</code> to get this for your own
            project.
          </p>

          <dl className="mt-12 overflow-hidden rounded-xl border border-border">
            {LEAVING.map((row, index) => (
              <div
                key={row.area}
                className={`grid gap-1 bg-card p-5 sm:grid-cols-[minmax(0,15rem)_1fr] sm:gap-6 ${
                  index > 0 ? 'border-t border-border' : ''
                }`}
              >
                <dt className="font-medium">{row.area}</dt>
                <dd className="text-sm leading-relaxed text-muted">{row.state}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section>
        <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8 sm:py-28">
          <div className="rounded-2xl border border-border bg-card p-10 text-center sm:p-16">
            <h2 className="text-title font-semibold tracking-tight text-balance">Deploy your first app</h2>
            <p className="mx-auto mt-4 max-w-xl text-muted text-pretty">
              You need Node 22, a running Docker, and a DigitalOcean token. The local commands need nothing but the
              first two.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Link
                href="/docs/quick-start"
                className="inline-flex h-11 items-center gap-2 rounded-lg bg-accent px-5 text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90"
              >
                Quick start
                <ArrowIcon className="h-4 w-4" />
              </Link>
              <Link
                href="/docs/commands"
                className="inline-flex h-11 items-center rounded-lg border border-border px-5 text-sm font-medium transition-colors hover:bg-card-hover"
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
