/**
 * Tests for the `docker build` argument list.
 *
 * A wrong `--platform` or a missing secret mount produces an image that only
 * fails on the deployment target, which is the most expensive place to find out.
 *
 * Author: Gowtham
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { buildArguments, dockerEnvironment } from './docker.js'
import type { ProjectInfo } from './detect.js'
import type { BuildIdentity } from './identity.js'

const project: ProjectInfo = {
  root: path.join('/home', 'dev', 'demo'),
  contextRoot: path.join('/home', 'dev', 'demo'),
  appDir: '.',
  name: 'demo',
  nextVersion: '16.3.4',
  packageManager: 'pnpm',
  lockfile: 'pnpm-lock.yaml',
  buildCommand: ['pnpm', 'run', 'build'],
  nodeMajor: '22',
  sharpVersion: null,
  envFiles: [],
  installerConfigs: [],
  installerSecrets: [],
  userDockerignore: null,
  localDependencies: [],
}

const context = {
  dockerfilePath: '/home/dev/demo/.nextship/Dockerfile',
  dockerfile: 'FROM node',
  helpers: ['adapter source', 'prune source'],
}
// Distinctive so a substring assertion cannot pass by accident: a short value
// like "k" appears inside "nextship_key" and would make the test meaningless.
const identity: BuildIdentity = {
  deploymentId: 'dpl-abc-1234',
  encryptionKey: 'S3CRET-KEY-MATERIAL-DO-NOT-LEAK',
  ephemeral: false,
  installerDigest: null,
}

const amd64 = { platform: 'linux/amd64', dockerHost: null }

/** Reads the value that follows a flag, so order changes do not break the tests. */
const valueAfter = (args: string[], flag: string): string | undefined => args[args.indexOf(flag) + 1]

test('always targets the deployment platform, never the build machine', () => {
  const args = buildArguments(project, context, identity, amd64, { target: 'runtime', tag: 'demo:dpl-abc-1234' })
  assert.equal(valueAfter(args, '--platform'), 'linux/amd64')
})

// An arm64 server runs only arm64 images, so the target's platform has to reach
// the build rather than the default one.
test('the platform a target asks for reaches the arguments, and the key still does not', () => {
  const args = buildArguments(
    project,
    context,
    identity,
    { platform: 'linux/arm64', dockerHost: 'unix:///tmp/nextship-tunnel/docker.sock' },
    { target: 'runtime', tag: 'demo:x' }
  )
  assert.equal(valueAfter(args, '--platform'), 'linux/arm64')
  assert.ok(!args.some((arg) => arg.includes(identity.encryptionKey)))
  assert.ok(!args.some((arg) => arg.includes('docker.sock')), 'the daemon is chosen by environment, not by argument')
})

test('DOCKER_HOST is set only when a target names another daemon', () => {
  assert.deepEqual(dockerEnvironment(amd64, { NEXTSHIP_KEY: 'k' }), { NEXTSHIP_KEY: 'k' })
  assert.deepEqual(dockerEnvironment({ platform: 'linux/amd64', dockerHost: 'unix:///s.sock' }, {}), {
    DOCKER_HOST: 'unix:///s.sock',
  })
})

test('passes the deployment id as a build arg and a label', () => {
  const args = buildArguments(project, context, identity, amd64, { target: 'runtime', tag: 'demo:x' })
  assert.equal(valueAfter(args, '--build-arg'), 'NEXTSHIP_DEPLOYMENT_ID=dpl-abc-1234')
  assert.equal(valueAfter(args, '--label'), 'sh.nextship.deployment=dpl-abc-1234')
})

test('the encryption key is passed by environment reference, never by path', () => {
  const args = buildArguments(project, context, identity, amd64, { target: 'manifest', outputDir: '/out' })
  const secrets = args.filter((_, index) => args[index - 1] === '--secret')
  assert.ok(secrets.includes('id=nextship_key,env=NEXTSHIP_KEY'))
  assert.ok(
    secrets.every((secret) => !secret.includes(identity.encryptionKey)),
    'the key itself must not appear in the argument list, which is visible in the process table'
  )
})

test('every env file becomes its own secret mount', () => {
  const args = buildArguments(
    { ...project, envFiles: ['.env.production', '.env'] },
    context,
    identity,
    amd64,
    { target: 'runtime', tag: 'demo:x' }
  )
  const secrets = args.filter((_, index) => args[index - 1] === '--secret')
  assert.equal(secrets.length, 3, 'the key plus one per env file')
  assert.ok(secrets.some((s) => s.startsWith('id=nextship_env_0,src=')))
  assert.ok(secrets.some((s) => s.startsWith('id=nextship_env_1,src=')))
})

test('the manifest target exports to a directory and carries no tag', () => {
  const args = buildArguments(project, context, identity, amd64, { target: 'manifest', outputDir: '/out' })
  assert.equal(valueAfter(args, '--target'), 'manifest')
  assert.equal(valueAfter(args, '--output'), 'type=local,dest=/out')
  assert.ok(!args.includes('--tag'))
})

test('the build context is the last argument, and is the workspace root', () => {
  const workspace = { ...project, root: '/home/dev/mono/apps/web', contextRoot: '/home/dev/mono', appDir: 'apps/web' }
  const args = buildArguments(workspace, context, identity, amd64, { target: 'runtime', tag: 'demo:x' })
  assert.equal(args.at(-1), '/home/dev/mono')
})

test('installer configuration is mounted from the context root and its digest passed above the install', () => {
  const args = buildArguments(
    { ...project, installerSecrets: ['.npmrc', '.yarnrc.yml'] },
    context,
    { ...identity, installerDigest: 'abc123' },
    amd64,
    { target: 'runtime', tag: 'demo:x' }
  )
  const secrets = args.filter((_, index) => args[index - 1] === '--secret')
  assert.ok(secrets.includes(`id=nextship_installer_0,src=${path.join(project.contextRoot, '.npmrc')}`))
  assert.ok(secrets.includes(`id=nextship_installer_1,src=${path.join(project.contextRoot, '.yarnrc.yml')}`))
  const buildArgs = args.filter((_, index) => args[index - 1] === '--build-arg')
  assert.ok(buildArgs.includes('NEXTSHIP_INSTALLER_DIGEST=abc123'))
})

test('a project without installer configuration passes no installer digest', () => {
  const args = buildArguments(project, context, identity, amd64, { target: 'runtime', tag: 'demo:x' })
  assert.ok(!args.some((arg) => arg.startsWith('NEXTSHIP_INSTALLER_DIGEST')))
})

test('the Next.js build cache is per project location, and stable for one location', () => {
  const same = buildArguments(project, context, identity, amd64, { target: 'runtime', tag: 'demo:x' })
  const again = buildArguments(project, context, identity, amd64, { target: 'runtime', tag: 'demo:y' })
  const cacheArg = (args: string[]) => args.find((arg) => arg.startsWith('NEXTSHIP_NEXT_CACHE_ID='))
  assert.match(cacheArg(same) ?? '', /^NEXTSHIP_NEXT_CACHE_ID=nextship-next-demo-[0-9a-f]{12}$/)
  assert.equal(cacheArg(same), cacheArg(again), 'one project keeps its cache across builds')

  // Two projects with the same name in different places: the case that shared a cache.
  const elsewhere = { ...project, root: '/tmp/other/demo', contextRoot: '/tmp/other/demo' }
  assert.notEqual(cacheArg(buildArguments(elsewhere, context, identity, amd64, { target: 'runtime', tag: 'demo:x' })), cacheArg(same))
})
