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
import { buildArguments } from './docker.js'
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
}

/** Reads the value that follows a flag, so order changes do not break the tests. */
const valueAfter = (args: string[], flag: string): string | undefined => args[args.indexOf(flag) + 1]

test('always targets the deployment platform, never the build machine', () => {
  const args = buildArguments(project, context, identity, { target: 'runtime', tag: 'demo:dpl-abc-1234' })
  assert.equal(valueAfter(args, '--platform'), 'linux/amd64')
})

test('passes the deployment id as a build arg and a label', () => {
  const args = buildArguments(project, context, identity, { target: 'runtime', tag: 'demo:x' })
  assert.equal(valueAfter(args, '--build-arg'), 'NEXTSHIP_DEPLOYMENT_ID=dpl-abc-1234')
  assert.equal(valueAfter(args, '--label'), 'sh.nextship.deployment=dpl-abc-1234')
})

test('the encryption key is passed by environment reference, never by path', () => {
  const args = buildArguments(project, context, identity, { target: 'manifest', outputDir: '/out' })
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
    { target: 'runtime', tag: 'demo:x' }
  )
  const secrets = args.filter((_, index) => args[index - 1] === '--secret')
  assert.equal(secrets.length, 3, 'the key plus one per env file')
  assert.ok(secrets.some((s) => s.startsWith('id=nextship_env_0,src=')))
  assert.ok(secrets.some((s) => s.startsWith('id=nextship_env_1,src=')))
})

test('the manifest target exports to a directory and carries no tag', () => {
  const args = buildArguments(project, context, identity, { target: 'manifest', outputDir: '/out' })
  assert.equal(valueAfter(args, '--target'), 'manifest')
  assert.equal(valueAfter(args, '--output'), 'type=local,dest=/out')
  assert.ok(!args.includes('--tag'))
})

test('the build context is the last argument, and is the workspace root', () => {
  const workspace = { ...project, root: '/home/dev/mono/apps/web', contextRoot: '/home/dev/mono', appDir: 'apps/web' }
  const args = buildArguments(workspace, context, identity, { target: 'runtime', tag: 'demo:x' })
  assert.equal(args.at(-1), '/home/dev/mono')
})
