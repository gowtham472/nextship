import { BuildMode, CodeDeployed, Firewall, ServerStatus } from '@/components/landing/illustrations'

/**
 * How a deployment to your own server goes, as four steps with a drawing each.
 *
 * Every claim is one the docs already make and a run has shown: the setup steps are
 * what `server add` applies, and the request count is the one measured on a
 * DigitalOcean Droplet (design.md §9.3). The commands are real ones, never output, so
 * nothing here pretends to be a transcript.
 *
 * Author: Gowtham
 */
const STEPS = [
  {
    title: 'Prepare the server',
    Illustration: Firewall,
    body: 'The plan shows the server’s host key fingerprint and every setup step, and changes nothing until --yes. Then it installs Docker if it is missing, runs Caddy on 80 and 443 for automatic HTTPS, turns on security updates and the ufw firewall where the server has it, and turns off password logins last. Run it again and nothing changes.',
    commands: ['nextship server add root@203.0.113.10', 'nextship server add root@203.0.113.10 --yes'],
  },
  {
    title: 'Build, with no Dockerfile',
    Illustration: BuildMode,
    body: 'Builds inside Docker with Next.js’s own Deployment Adapter injected, on the server over SSH or on your machine with --build local, then keeps only the files the build traced. A 1.13 GB tree becomes a 591 MB image.',
    commands: ['nextship deploy --yes'],
  },
  {
    title: 'Release without downtime',
    Illustration: CodeDeployed,
    body: 'The new container starts with no public port. Caddy switches to it only once Docker reports it healthy, then the previous one stops, with 30 seconds for requests still in flight. A deployment that cannot start is refused, and the old one keeps serving.',
    measured: '579 of 579 requests succeeded across a deployment on a DigitalOcean Droplet',
  },
  {
    title: 'Keep it running',
    Illustration: ServerStatus,
    body: 'Every app on the server, and what needs attention, in one command. Logs keep their history, rollback reuses an image that already ran, a watchdog restarts an app that hangs, and one server can host several apps.',
    commands: ['nextship server status', 'nextship rollback --yes'],
  },
]

export function ServerFlow() {
  return (
    <ol className="space-y-6 sm:space-y-8">
      {STEPS.map((step, index) => (
        <li
          key={step.title}
          className="reveal grid grid-cols-1 items-center gap-8 overflow-hidden rounded-2xl border border-border bg-card p-6 sm:p-9 lg:grid-cols-2 lg:gap-14"
        >
          <div className={`min-w-0 ${index % 2 === 1 ? 'lg:order-2' : ''}`}>
            <p className="font-mono text-sm text-accent-text">Step {String(index + 1).padStart(2, '0')} of 04</p>
            <h3 className="mt-2 text-2xl font-extrabold tracking-[-0.03em] sm:text-3xl">{step.title}</h3>
            <p className="mt-4 text-base leading-relaxed text-muted text-pretty">{step.body}</p>
            {step.commands ? (
              <div className="mt-6 space-y-1.5 rounded-xl border border-border bg-background-subtle px-4 py-3 font-mono text-[13px] leading-6">
                {step.commands.map((command) => (
                  <p key={command} className="overflow-x-auto whitespace-nowrap text-muted-strong">
                    <span className="mr-2 text-accent-text select-none">$</span>
                    {command}
                  </p>
                ))}
              </div>
            ) : null}
            {step.measured ? (
              <p className="mt-6 inline-flex items-start gap-2.5 rounded-xl border border-border bg-background-subtle px-4 py-2.5 text-sm font-medium text-muted-strong">
                <span className="mt-[0.45rem] h-1.5 w-1.5 shrink-0 bg-highlight" aria-hidden="true" />
                {step.measured}
              </p>
            ) : null}
          </div>
          <div className={`flex min-w-0 justify-center ${index % 2 === 1 ? 'lg:order-1' : ''}`}>
            <step.Illustration className="h-56 w-auto max-w-full sm:h-64" />
          </div>
        </li>
      ))}
    </ol>
  )
}
