#!/usr/bin/env node
/**
 * @nextship/cli: entry point
 *
 * Parses argv and runs the pipeline. Each stage is also exposed as its own
 * command so a failure can be re-run in isolation without repeating the stages
 * that already succeeded.
 *
 * Author: Gowtham
 * Design: ../../../docs/design.md §4
 */

import { detectProject } from './detect.js'
import { buildProject } from './build.js'
import { packageImage } from './packaging.js'
import { runImage } from './run.js'
import { diagnose, type Finding } from './doctor.js'
import { deploy } from './deploy.js'
import { listEnv, pushEnv, removeEnv } from './env.js'
import { addDomain, listDomains, removeDomain, DEFAULT_MIN_TLS } from './domain.js'
import { listImages, pruneImages, DEFAULT_KEEP } from './images.js'
import { destroy } from './destroy.js'
import { rollback } from './rollback.js'
import { logs } from './logs.js'
import { logoDepth, renderLogo } from './logo.js'
import { DEFAULT_INSTANCE_SIZE } from './targets/digitalocean.js'
import { NextshipError } from './errors.js'
import { TARGET_PLATFORM } from './image/dockerfile.js'
import { VERSION } from './version.js'
import { detail, fail, ok, step, warn } from './util/log.js'

// Node ignores source maps unless asked, so a stack trace would report a position
// in emitted JavaScript that nobody can act on. With this, a trace in a bug report
// names the TypeScript line that actually failed, and the maps carry their own
// sources so it resolves from an installed package rather than needing src/.
//
// Placement below the imports is deliberate: ES module imports are hoisted and
// evaluated first regardless of where this sits, so putting it above them would
// imply an ordering that does not exist. Everything this needs to cover happens
// after module evaluation.
process.setSourceMapsEnabled(true)

const USAGE = `nextship

Usage
  nextship detect     Report what nextship reads from this project
  nextship build      Build in Docker with the adapter injected, export the manifest
  nextship package    Build, then produce the runtime image
  nextship run        Package, then run the image locally
  nextship doctor     Report what changes when this app leaves Vercel
  nextship deploy     Show the deployment plan; add --yes to execute it
  nextship rollback   Return to a previous deployment; add --yes to execute it
  nextship logs       Runtime logs for the deployed app; --follow to stream
  nextship env        List the runtime environment variables set on the app
  nextship env push   Upload this project's env files as runtime variables
  nextship env rm     Remove named variables from the app
  nextship domain     List the domains attached to the app
  nextship domain add Attach a domain and print the DNS record to create
  nextship domain rm  Detach a domain
  nextship images     List the images pushed for this project
  nextship images prune  Remove old images, keeping the recent ones
  nextship destroy <name>  Destroy the app this project created

Options
  -h, --help          Show this message
  -v, --version       Show the version

Deploy options
  --yes               Execute the plan. Without it, deploy only prints the plan
  --region <slug>     DigitalOcean region (default blr)
  --size <slug>       App Platform instance size (default ${DEFAULT_INSTANCE_SIZE})
  --registry <name>   Registry name, unique across all of DigitalOcean

Rollback options
  --yes               Execute the plan. Without it, rollback only prints the plan
  --to <deployment>   Roll back to a specific deployment instead of the last one

Log options
  --follow            Stream new output as it arrives instead of printing a snapshot

Env options
  --yes               Execute the plan. Without it, env only prints the plan
  nextship env rm KEY [KEY...]   Every key is named; there is no wildcard

Destroy options
  --yes               Execute the plan. Without it, destroy only prints the plan
  --images            Also remove this project's images, then collect the storage
  The app name is required, so a --yes in the wrong directory cannot destroy it

Image options
  --yes               Execute the plan. Without it, prune only prints the plan
  --keep <n>          Images to keep (default ${DEFAULT_KEEP}); the deployed one is always kept
  --gc                Start garbage collection, which is what reclaims storage

Domain options
  --yes               Execute the plan. Without it, domain only prints the plan
  --primary           Make the domain the app's main address rather than an alias
  --min-tls <1.2|1.3> Minimum TLS version clients may use (default ${DEFAULT_MIN_TLS})
`

/**
 * Draws the wordmark when standard output is a terminal wide enough to hold it, and
 * reports whether it did. Anywhere else `nextship` on its own prints the usage, which
 * is what a script running it has always received.
 */
function showLogo(): boolean {
  const depth = logoDepth({
    isTTY: process.stdout.isTTY === true,
    columns: process.stdout.columns ?? 0,
    colorDepth: process.stdout.isTTY ? process.stdout.getColorDepth() : 1,
    noColor: Boolean(process.env.NO_COLOR),
  })
  if (!depth) return false
  process.stdout.write(
    `\n${renderLogo(depth)}\n  nextship ${VERSION}\n` +
      '  Start with `nextship detect` in a Next.js project.\n' +
      '  `nextship --help` lists every command.\n\n'
  )
  return true
}

async function main(argv: string[]): Promise<void> {
  const command = argv[0]

  if (!command && showLogo()) return

  if (!command || command === '-h' || command === '--help') {
    process.stdout.write(USAGE)
    return
  }

  if (command === '-v' || command === '--version') {
    process.stdout.write(`${VERSION}\n`)
    return
  }

  switch (command) {
    case 'detect':
      return runDetect()
    case 'build':
      return runBuild()
    case 'package':
      return runPackage()
    case 'run':
      return runLocally()
    case 'doctor':
      return runDoctor()
    case 'deploy':
      return runDeploy(argv.slice(1))
    case 'rollback':
      return runRollback(argv.slice(1))
    case 'logs':
      return runLogs(argv.slice(1))
    case 'env':
      return runEnv(argv.slice(1))
    case 'domain':
      return runDomain(argv.slice(1))
    case 'images':
      return runImages(argv.slice(1))
    case 'destroy':
      return runDestroy(argv.slice(1))
    default:
      throw new NextshipError(`Unknown command \`${command}\`.`, 'Run `nextship --help` to see the available commands.')
  }
}

async function runDetect(): Promise<void> {
  step('Inspecting project')
  const project = await detectProject(process.cwd())

  ok(`${project.name} is a Next.js ${project.nextVersion} project`)
  detail(`root          ${project.root}`)
  if (project.appDir !== '.') {
    detail(`workspace     ${project.contextRoot}`)
    detail(`app dir       ${project.appDir}`)
  }
  detail(`package mgr   ${project.packageManager}${project.lockfile ? '' : ' (no lockfile)'}`)
  detail(`build command ${project.buildCommand.join(' ')}`)
  detail(`node          ${project.nodeMajor}`)
  detail(`sharp         ${project.sharpVersion ?? 'not resolvable from the app root'}`)
  detail(`env files     ${project.envFiles.length > 0 ? project.envFiles.join(', ') : 'none'}`)
}

async function runBuild(): Promise<void> {
  const project = await detectProject(process.cwd())
  const build = await buildProject(project)

  ok(`Built ${build.manifest.framework.name} ${build.manifest.framework.version}`)
  detail(`build      ${build.manifest.buildId}`)
  detail(`deployment ${build.manifest.deploymentId}`)
}

async function runPackage(): Promise<void> {
  const project = await detectProject(process.cwd())
  const build = await buildProject(project)
  const image = await packageImage(project, build)

  ok(`Image ready: ${image.tag}`)
  detail(`platform   ${TARGET_PLATFORM}`)
  detail('start it with: nextship run')
}

async function runDoctor(): Promise<void> {
  step('Checking this project')
  const project = await detectProject(process.cwd())
  const findings = await diagnose(project)

  const blockers = findings.filter((finding) => finding.level === 'blocker')
  const warnings = findings.filter((finding) => finding.level === 'warning')

  for (const finding of findings) report(finding)

  if (blockers.length === 0 && warnings.length === 0) {
    ok('Nothing found that changes behaviour off Vercel.')
    return
  }

  const summary = [
    blockers.length > 0 ? `${blockers.length} blocker(s)` : null,
    warnings.length > 0 ? `${warnings.length} warning(s)` : null,
  ]
    .filter(Boolean)
    .join(', ')

  // Undeclared packages fail the build outright, unlike every other finding
  // here, which changes behaviour silently. Claiming nothing stops a build
  // while reporting one that does would teach the reader to skim the rest.
  ok(`${summary}. Blockers fail the build or stop a feature working; warnings change behaviour silently.`)
}

function report(finding: Finding): void {
  const line = `${finding.title}: ${finding.consequence}`
  if (finding.level === 'note') detail(line)
  else warn(line)
  detail(`  ${finding.action}`)
}

/** Reads `--flag value` pairs, so an unknown flag is an error rather than silently ignored. */
function parseFlags(argv: string[], allowed: string[]): Map<string, string | true> {
  const flags = new Map<string, string | true>()
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (!token.startsWith('--')) {
      throw new NextshipError(`Unexpected argument \`${token}\`.`, 'Run `nextship --help`.')
    }
    const name = token.slice(2)
    if (!allowed.includes(name)) {
      throw new NextshipError(`Unknown option \`${token}\`.`, 'Run `nextship --help`.')
    }
    const next = argv[index + 1]
    if (next && !next.startsWith('--')) {
      flags.set(name, next)
      index += 1
    } else {
      flags.set(name, true)
    }
  }
  return flags
}

async function runDeploy(argv: string[]): Promise<void> {
  const flags = parseFlags(argv, ['yes', 'region', 'size', 'registry'])
  const project = await detectProject(process.cwd())

  await deploy(project, {
    confirmed: flags.get('yes') === true,
    region: typeof flags.get('region') === 'string' ? (flags.get('region') as string) : 'blr',
    instanceSize:
      typeof flags.get('size') === 'string' ? (flags.get('size') as string) : DEFAULT_INSTANCE_SIZE,
    registry: typeof flags.get('registry') === 'string' ? (flags.get('registry') as string) : undefined,
  })
}

/**
 * `env` lists, `env push` writes. The subcommand is read before the flags so an
 * unknown one is refused by name rather than being parsed as a stray argument.
 */
async function runEnv(argv: string[]): Promise<void> {
  const hasSubcommand = argv.length > 0 && !argv[0].startsWith('--')
  const subcommand = hasSubcommand ? argv[0] : null
  const rest = hasSubcommand ? argv.slice(1) : argv

  const project = await detectProject(process.cwd())
  if (subcommand === null) {
    // `nextship env --yes` would be a push the user did not ask for, so flags
    // without a subcommand are refused rather than ignored.
    parseFlags(rest, [])
    return listEnv(project)
  }
  if (subcommand === 'push') {
    const flags = parseFlags(rest, ['yes'])
    return pushEnv(project, { confirmed: flags.get('yes') === true })
  }

  if (subcommand === 'rm') {
    // Keys are positional, so they are split from the flags before parsing
    // rather than being rejected as unexpected arguments.
    const keys = rest.filter((token) => !token.startsWith('--'))
    const flags = parseFlags(
      rest.filter((token) => token.startsWith('--')),
      ['yes']
    )
    return removeEnv(project, { confirmed: flags.get('yes') === true, keys })
  }

  throw new NextshipError(
    `Unknown env subcommand \`${subcommand}\`.`,
    'Use `nextship env` to list, `nextship env push` to upload, or `nextship env rm KEY` to remove.'
  )
}

async function runLogs(argv: string[]): Promise<void> {
  const flags = parseFlags(argv, ['follow'])
  const project = await detectProject(process.cwd())
  await logs(project, { follow: flags.get('follow') === true })
}

/**
 * `destroy` takes the app name as an argument on purpose. Every other command
 * acts on the current directory, and this one cannot be undone, so the name has
 * to agree with what the project recorded before `--yes` means anything.
 */
async function runDestroy(argv: string[]): Promise<void> {
  const positional = argv.filter((token) => !token.startsWith('--'))
  const flags = parseFlags(
    argv.filter((token) => token.startsWith('--')),
    ['yes', 'images']
  )

  if (positional.length !== 1) {
    throw new NextshipError(
      positional.length === 0 ? 'No app name was given.' : `Expected one app name, got ${positional.length}.`,
      'Run `nextship destroy <app-name>`. The name is required so this cannot run by accident.'
    )
  }

  const project = await detectProject(process.cwd())
  await destroy(project, {
    confirmed: flags.get('yes') === true,
    name: positional[0],
    images: flags.get('images') === true,
  })
}

/** `images` lists, `images prune` removes. */
async function runImages(argv: string[]): Promise<void> {
  const hasSubcommand = argv.length > 0 && !argv[0].startsWith('--')
  const subcommand = hasSubcommand ? argv[0] : null
  const rest = hasSubcommand ? argv.slice(1) : argv

  const project = await detectProject(process.cwd())
  if (subcommand === null) {
    parseFlags(rest, [])
    return listImages(project)
  }

  if (subcommand !== 'prune') {
    throw new NextshipError(
      `Unknown images subcommand \`${subcommand}\`.`,
      'Use `nextship images` to list, or `nextship images prune` to remove old ones.'
    )
  }

  const flags = parseFlags(rest, ['yes', 'keep', 'gc'])
  const keep = flags.get('keep')
  if (keep !== undefined && typeof keep !== 'string') {
    throw new NextshipError('--keep needs a number.', 'For example `nextship images prune --keep 3`.')
  }

  await pruneImages(project, {
    confirmed: flags.get('yes') === true,
    keep: typeof keep === 'string' ? Number(keep) : DEFAULT_KEEP,
    collect: flags.get('gc') === true,
  })
}

/** `domain` lists, `domain add` and `domain rm` take a hostname argument. */
async function runDomain(argv: string[]): Promise<void> {
  const hasSubcommand = argv.length > 0 && !argv[0].startsWith('--')
  const subcommand = hasSubcommand ? argv[0] : null
  const rest = hasSubcommand ? argv.slice(1) : argv

  const project = await detectProject(process.cwd())
  if (subcommand === null) {
    parseFlags(rest, [])
    return listDomains(project)
  }

  if (subcommand !== 'add' && subcommand !== 'rm') {
    throw new NextshipError(
      `Unknown domain subcommand \`${subcommand}\`.`,
      'Use `nextship domain` to list, `nextship domain add <domain>`, or `nextship domain rm <domain>`.'
    )
  }

  const positional = rest.filter((token) => !token.startsWith('--'))
  const flags = parseFlags(
    rest.filter((token) => token.startsWith('--')),
    subcommand === 'add' ? ['yes', 'primary', 'min-tls'] : ['yes']
  )

  if (positional.length !== 1) {
    throw new NextshipError(
      positional.length === 0 ? 'No domain was named.' : `Expected one domain, got ${positional.length}.`,
      `Run \`nextship domain ${subcommand} <domain>\`, for example preview.example.com.`
    )
  }

  const confirmed = flags.get('yes') === true
  if (subcommand === 'rm') return removeDomain(project, { confirmed, domain: positional[0] })

  const minTls = flags.get('min-tls')
  return addDomain(project, {
    confirmed,
    domain: positional[0],
    primary: flags.get('primary') === true,
    minimumTls: typeof minTls === 'string' ? minTls : DEFAULT_MIN_TLS,
  })
}

async function runRollback(argv: string[]): Promise<void> {
  const flags = parseFlags(argv, ['yes', 'to'])
  const project = await detectProject(process.cwd())

  await rollback(project, {
    confirmed: flags.get('yes') === true,
    to: typeof flags.get('to') === 'string' ? (flags.get('to') as string) : undefined,
  })
}

async function runLocally(): Promise<void> {
  const project = await detectProject(process.cwd())
  const build = await buildProject(project)
  const image = await packageImage(project, build)

  await runImage(project, image)
}

main(process.argv.slice(2)).catch((error: unknown) => {
  if (error instanceof NextshipError) {
    fail(error.message, error.action)
  } else {
    fail(
      error instanceof Error ? error.message : String(error),
      'This is unexpected. Please report it with the output above.'
    )
  }
  process.exitCode = 1
})
