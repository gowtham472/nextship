/**
 * Tests for destroy.
 *
 * This is the only command that removes infrastructure, and the failure it
 * guards against is running in the wrong directory. That check is pure, so it
 * is pinned here; the deletion itself was verified against a disposable app.
 *
 * Author: Gowtham
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nameMatches, previewsOf } from './destroy.js'
import { NextshipError } from './errors.js'

function rejects(run: () => unknown, fragment: string): void {
  assert.throws(run, (error: unknown) => {
    assert.ok(error instanceof NextshipError, 'expected a NextshipError')
    assert.match(error.message, new RegExp(fragment, 'i'))
    assert.ok(error.action.length > 0, 'every error carries a next action')
    return true
  })
}

test('the recorded name is accepted', () => {
  nameMatches('portfolio', 'portfolio')
})

test('any other name is refused, which is what stops the wrong directory', () => {
  rejects(() => nameMatches('some-other-app', 'portfolio'), 'not "some-other-app"')
})

test('the check is exact, not fuzzy', () => {
  rejects(() => nameMatches('Portfolio', 'portfolio'), 'not "Portfolio"')
  rejects(() => nameMatches('portfolio ', 'portfolio'), 'not "portfolio "')
  rejects(() => nameMatches('portfol', 'portfolio'), 'not "portfol"')
})

test('the error names the app that would actually be destroyed', () => {
  assert.throws(
    () => nameMatches('wrong', 'the-real-app'),
    (error: unknown) => {
      assert.ok(error instanceof NextshipError)
      assert.match(error.action, /nextship destroy the-real-app/, 'so the correct command is one copy away')
      assert.match(error.action, /Nothing was changed/)
      return true
    }
  )
})

// The defect: destroying an app left its previews running, and with the app's id
// gone from nextship.json nothing could ever match them again.
test('the previews destroyed with an app are exactly the ones that name it', () => {
  const apps = [
    { id: 'main', name: 'shop' },
    { id: 'p1', name: 'shop-pr-1', previewOf: 'main' },
    { id: 'p2', name: 'shop-pr-2', previewOf: 'main' },
    { id: 'other', name: 'blog' },
    { id: 'p3', name: 'blog-pr-1', previewOf: 'other' },
    // Named like a preview of shop, but not one: never matched by name.
    { id: 'x', name: 'shop-pr-9' },
  ]
  assert.deepEqual(previewsOf(apps, 'main').map((entry) => entry.id), ['p1', 'p2'])
  assert.deepEqual(previewsOf(apps, 'none'), [])
})
