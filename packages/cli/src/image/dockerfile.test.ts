/**
 * Tests for Dockerfile and ignore file rendering. These pin the instructions
 * that exist for a documented reason, so removing one is a visible break.
 *
 * Author: Gowtham
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { ProjectInfo } from '../detect.js'
import { renderDockerfile, renderDockerignore } from './dockerfile.js'

const base: ProjectInfo = {
  root: '/home/dev/demo',
  contextRoot: '/home/dev/demo',
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

test('standalone project renders a three-stage build', () => {
  const dockerfile = renderDockerfile(base)

  assert.match(dockerfile, /^# syntax=docker\/dockerfile:1/)
  assert.match(dockerfile, /FROM node:22-slim AS builder/)
  assert.match(dockerfile, /FROM scratch AS manifest/)
  assert.match(dockerfile, /FROM node:22-slim AS runtime/)

  assert.match(dockerfile, /RUN --mount=type=cache,id=nextship-pnpm,target=\/cache\/pnpm pnpm install --frozen-lockfile/)
  assert.match(dockerfile, /--mount=type=cache,id=nextship-next-demo,target=\/src\/\.next\/cache/)

  // The install must not depend on the source tree. Measured: the install is 97s
  // and the compile is 6s, so copying sources first made every edit pay for both.
  const manifests = dockerfile.indexOf('COPY --parents')
  const install = dockerfile.indexOf('pnpm install --frozen-lockfile')
  const sources = dockerfile.indexOf('\nCOPY . .')
  assert.ok(manifests < install, 'manifests are copied before the install')
  assert.ok(install < sources, 'sources are copied after the install')
  assert.match(dockerfile, /COPY --parents package\.json pnpm-lock\.yaml \.\//)
  assert.match(dockerfile, /ARG NEXTSHIP_DEPLOYMENT_ID/)
  assert.match(dockerfile, /NEXT_ADAPTER_PATH=\/src\/\.nextship\/build\/adapter\.mjs/)
  assert.match(dockerfile, /--mount=type=secret,id=nextship_key/)
  assert.match(dockerfile, /NEXT_SERVER_ACTIONS_ENCRYPTION_KEY="\$\(cat \/run\/secrets\/nextship_key\)" pnpm run build/)
  assert.match(dockerfile, /RUN node \.nextship\/build\/prune\.cjs \/src \. \/out/)
  assert.match(dockerfile, /COPY --from=builder \/src\/\.nextship\/output\/manifest\.json \/manifest\.json/)

  assert.match(dockerfile, /tini libjemalloc2/)
  assert.match(dockerfile, /rm -rf \/usr\/local\/lib\/node_modules/, 'npm and corepack leave the runtime image')
  assert.match(dockerfile, /RUN groupadd --system app && useradd --system --gid app app\nCOPY --from=builder --chown=app:app \/out \/src/)
  assert.match(dockerfile, /RUN mkdir -p \.next\/cache && chown app:app \.next\/cache/)
  assert.match(dockerfile, /\nUSER app\n/)
  assert.match(dockerfile, /HEALTHCHECK --interval=30s/)
  assert.match(dockerfile, /ENTRYPOINT \["\/usr\/bin\/tini", "--"\]\nCMD \["node", "server\.cjs"\]/)

  assert.doesNotMatch(dockerfile, /COPY node_modules/, 'dependencies are never copied from the host')
  assert.doesNotMatch(dockerfile, /chown -R/, 'a recursive chown duplicates every file into a new layer')
})

test('workspace package builds from the workspace root and keeps its path', () => {
  const dockerfile = renderDockerfile({
    ...base,
    root: '/home/dev/mono/apps/web',
    contextRoot: '/home/dev/mono',
    appDir: 'apps/web',
    envFiles: ['.env.production', '.env'],
  })

  // A workspace install needs every sibling manifest, which the recursive glob
  // collects. --parents keeps each one in its own directory.
  assert.match(dockerfile, /COPY --parents \*\*\/package\.json package\.json pnpm-lock\.yaml \.\//)
  assert.match(dockerfile, /pnpm install --frozen-lockfile\nCOPY \. \.\nWORKDIR \/src\/apps\/web/)
  assert.match(dockerfile, /NEXT_ADAPTER_PATH=\/src\/apps\/web\/\.nextship\/build\/adapter\.mjs/)
  assert.match(dockerfile, /--mount=type=secret,id=nextship_env_0,target=\/src\/apps\/web\/\.env\.production/)
  assert.match(dockerfile, /--mount=type=secret,id=nextship_env_1,target=\/src\/apps\/web\/\.env /)
  assert.match(dockerfile, /prune\.cjs \/src apps\/web \/out/)
  assert.match(dockerfile, /COPY --from=builder \/src\/apps\/web\/\.nextship\/output\/manifest\.json/)
  assert.match(dockerfile, /FROM node:22-slim AS runtime\nWORKDIR \/src\/apps\/web/)
})

test('installer configuration is copied before the install that reads it', () => {
  // pnpm 10 keeps allowed build scripts in pnpm-workspace.yaml even for a single
  // package, and a frozen install fails with ERR_PNPM_IGNORED_BUILDS without it.
  const dockerfile = renderDockerfile({ ...base, installerConfigs: ['pnpm-workspace.yaml', '.npmrc'] })
  assert.match(dockerfile, /COPY --parents package\.json pnpm-lock\.yaml pnpm-workspace\.yaml \.npmrc \.\//)
  assert.ok(dockerfile.indexOf('.npmrc') < dockerfile.indexOf('pnpm install'))
})

test('install command follows the package manager and the presence of a lockfile', () => {
  assert.match(renderDockerfile({ ...base, packageManager: 'npm', lockfile: 'package-lock.json' }), /npm ci --no-audit --no-fund/)
  assert.match(renderDockerfile({ ...base, packageManager: 'npm', lockfile: null }), /npm install --no-audit --no-fund/)
  assert.match(renderDockerfile({ ...base, packageManager: 'yarn', lockfile: 'yarn.lock' }), /YARN_CACHE_FOLDER=\/cache\/yarn/)
  assert.match(renderDockerfile({ ...base, packageManager: 'bun', lockfile: 'bun.lockb' }), /bun install --frozen-lockfile/)
})

test('ignore file keeps secrets and host artefacts out, lets build helpers in', () => {
  const ignore = renderDockerignore(base)
  const lines = ignore.trimEnd().split('\n')

  assert.ok(lines.includes('**/node_modules'))
  assert.ok(lines.includes('**/.git'))
  assert.ok(lines.includes('**/.next'))
  assert.ok(lines.includes('**/.nextship'))
  assert.ok(lines.includes('!.nextship/build'))
  assert.ok(lines.includes('**/.env'))
  assert.ok(lines.includes('**/.env.*'))
  assert.ok(lines.indexOf('**/.nextship') < lines.indexOf('!.nextship/build'), 'the re-include must come after the exclude')
})

test('project rules come first, so ours cannot be undone by them', () => {
  const ignore = renderDockerignore({ ...base, userDockerignore: '!.env\n!node_modules\n' })
  const lines = ignore.trimEnd().split('\n')

  // Docker resolves conflicts by last match, so ours must appear after theirs.
  assert.ok(lines.indexOf('!.env') < lines.indexOf('**/.env'), 'a project !.env must not win')
  assert.ok(
    lines.indexOf('!node_modules') < lines.indexOf('**/node_modules'),
    'a project !node_modules must not win'
  )
})

test('the build helper re-include is scoped to the app directory', () => {
  const ignore = renderDockerignore({ ...base, appDir: 'apps/web', userDockerignore: 'coverage\n' })
  assert.match(ignore, /!apps\/web\/\.nextship\/build/)
  assert.match(ignore, /# Rules from the project \.dockerignore\ncoverage/)
})
