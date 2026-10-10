import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

// The guard runs on the server, which is Linux with GNU find; its `-printf` and
// `-newermt @<epoch>` have no BSD equivalent, so these run where the server's tools are.
const linuxOnly = { skip: process.platform !== 'linux' }

const GUARD = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../runtime/vm/cache-guard.sh')

/** A 64 KiB file whose last access is `accessed` seconds after the epoch and last change `modified`. */
function entry(file: string, accessed: number, modified: number): void {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, Buffer.alloc(64 * 1024, 1))
  execFileSync('touch', ['-m', '-d', `@${modified}`, file])
  execFileSync('touch', ['-a', '-d', `@${accessed}`, file])
}

/** Runs `evict <limit KiB> <volumes...>` from the real script; returns "<files> <KiB>" it removed. */
function evict(limitKib: number, ...volumes: string[]): string {
  // The script is named by $1, not $0: sourced with $0 set to its own path, it would
  // take itself to be run by the timer and start guarding this machine.
  const script = 'guard="$1"; shift; source "$guard" && evict "$@"'
  return execFileSync('bash', ['-c', script, 'cache-guard-test', GUARD, String(limitKib), ...volumes], { encoding: 'utf8' }).trim()
}

function volume(): string {
  return mkdtempSync(path.join(tmpdir(), 'nextship-cache-guard-'))
}

test('nothing is removed while an app is under its limit', linuxOnly, () => {
  const cache = volume()
  entry(path.join(cache, 'images/a/1.webp'), 1000, 1000)
  entry(path.join(cache, 'images/b/2.webp'), 2000, 2000)
  assert.equal(evict(1024, cache), '0 0')
  assert.ok(existsSync(path.join(cache, 'images/a/1.webp')))
  rmSync(cache, { recursive: true })
})

test('over the limit, the least recently used go first, down to 80% of it, with their directories', linuxOnly, () => {
  const cache = volume()
  for (let i = 0; i < 10; i++) entry(path.join(cache, `images/${i}/img.webp`), 1000 + i, 1000)
  // Ten 64 KiB entries against a 512 KiB limit: 640 KiB must come down to 409 KiB or
  // less, which is four removed, and the four are the oldest by access.
  const [files] = evict(512, cache).split(' ')
  assert.equal(files, '4')
  for (let i = 0; i < 4; i++) assert.ok(!existsSync(path.join(cache, `images/${i}`)), `entry ${i} should be evicted`)
  for (let i = 4; i < 10; i++) assert.ok(existsSync(path.join(cache, `images/${i}/img.webp`)), `entry ${i} should be kept`)
  rmSync(cache, { recursive: true })
})

// The defect this prevents: a page with no revalidate time losing the file it was
// prerendered into, which Next.js would then have to render at runtime, where the
// data it was built from may not exist.
test('in a build volume, only files changed after it was created can go, however far over the limit', linuxOnly, () => {
  const build = volume()
  const created = 5000
  entry(path.join(build, 'server/app/about.html'), 100, created - 100)
  entry(path.join(build, 'server/app/blog/one.html'), 200, created + 100)
  entry(path.join(build, 'server/app/blog/two.html'), 300, created + 200)
  const [files] = evict(64, `${build}@${created}`).split(' ')
  assert.equal(files, '2')
  assert.ok(existsSync(path.join(build, 'server/app/about.html')))
  assert.ok(!existsSync(path.join(build, 'server/app/blog')))
  rmSync(build, { recursive: true })
})

test('an app\'s limit covers its cache and build volumes together', linuxOnly, () => {
  const cache = volume()
  const build = volume()
  entry(path.join(cache, 'fetch-cache/old'), 1000, 6000)
  entry(path.join(build, 'server/app/new.html'), 9000, 6000)
  entry(path.join(build, 'server/app/newer.html'), 9500, 6000)
  // 192 KiB against 128 must come down to 102 KiB or less: the two oldest by access
  // go, one from each volume, and the newest stays.
  assert.equal(evict(128, cache, `${build}@5000`).split(' ')[0], '2')
  assert.ok(!existsSync(path.join(cache, 'fetch-cache/old')))
  assert.ok(existsSync(path.join(build, 'server/app/newer.html')))
  rmSync(cache, { recursive: true })
  rmSync(build, { recursive: true })
})

// The defect: sorted by access time alone, a volume mounted `noatime` never updates
// one, so every file tied at its creation and the guard evicted in no order at
// all, the busiest entries included.
test('where access times are not kept, the oldest written goes first', linuxOnly, () => {
  const cache = volume()
  // Every access time is the same, as it is when the kernel never updates them.
  entry(path.join(cache, 'images/old/img.webp'), 100, 5000)
  entry(path.join(cache, 'images/mid/img.webp'), 100, 7000)
  entry(path.join(cache, 'images/new/img.webp'), 100, 9000)
  assert.equal(evict(128, cache).split(' ')[0], '2')
  assert.ok(existsSync(path.join(cache, 'images/new/img.webp')), 'the newest written is kept')
  assert.ok(!existsSync(path.join(cache, 'images/old')) && !existsSync(path.join(cache, 'images/mid')))
  rmSync(cache, { recursive: true })
})

test('a file read recently is kept over one written more recently but not read since', linuxOnly, () => {
  const cache = volume()
  entry(path.join(cache, 'images/read/img.webp'), 9000, 1000)
  entry(path.join(cache, 'images/written/img.webp'), 100, 5000)
  entry(path.join(cache, 'images/idle/img.webp'), 100, 2000)
  assert.equal(evict(128, cache).split(' ')[0], '2')
  assert.ok(existsSync(path.join(cache, 'images/read/img.webp')))
  rmSync(cache, { recursive: true })
})
