/**
 * Tests for documentation links.
 *
 * The source scan exists because every relative path it replaced was written by
 * hand at its call site, and nothing stopped the next one. Comments are exempt:
 * they are read in the repository, where a relative path resolves.
 *
 * Author: Gowtham
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { docsUrl } from './links.js'

test('documentation links are absolute, so they resolve outside the repository', () => {
  assert.equal(
    docsUrl('design.md', '12-known-limitations'),
    'https://github.com/gowtham472/nextship/blob/main/docs/design.md#12-known-limitations'
  )
  assert.equal(docsUrl('digitalocean.md'), 'https://github.com/gowtham472/nextship/blob/main/docs/digitalocean.md')
})

test('no string in the source points a user at a relative docs path', async () => {
  const source = fileURLToPath(new URL('../src', import.meta.url))
  const offenders: string[] = []

  for (const file of await sourceFiles(source)) {
    const lines = (await readFile(file, 'utf8')).split('\n')
    lines.forEach((line, index) => {
      const code = line.trim()
      if (code.startsWith('*') || code.startsWith('//') || code.startsWith('/*')) return
      if (/docs\/[\w-]+\.md/.test(code) && !code.includes('https://')) {
        offenders.push(`${path.relative(source, file)}:${index + 1}`)
      }
    })
  }

  assert.deepEqual(offenders, [], 'use docsUrl() so the link resolves from an installed package')
})

async function sourceFiles(dir: string): Promise<string[]> {
  const found: string[] = []

  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) found.push(...(await sourceFiles(full)))
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) found.push(full)
  }

  return found
}
