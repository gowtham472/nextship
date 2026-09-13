/**
 * The health path choice, pinned against the manifest Next.js 16.3.4 writes for an
 * app whose homepage is dynamic.
 *
 * Author: Gowtham
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { chooseHealthPath } from './index.js'

// Recorded from `next build` of an app with a force-dynamic `/` and a 30 second ISR route.
const DYNAMIC_HOME = {
  '/_global-error': { dataRoute: '/_global-error.rsc' },
  '/_not-found': { initialStatus: 404, dataRoute: '/_not-found.rsc' },
  '/isr': { dataRoute: '/isr.rsc' },
}

test('a dynamic homepage is not probed on the internal error page, which answers 500', () => {
  assert.equal(chooseHealthPath(DYNAMIC_HOME), '/isr')
})

test('the homepage is chosen whenever it is prerendered', () => {
  assert.equal(chooseHealthPath({ ...DYNAMIC_HOME, '/': { dataRoute: '/index.rsc' } }), '/')
})

test('only internal pages prerendered leaves nothing to probe, so the CLI falls back to /', () => {
  assert.equal(
    chooseHealthPath({ '/_global-error': DYNAMIC_HOME['/_global-error'], '/_not-found': DYNAMIC_HOME['/_not-found'] }),
    null
  )
})

test('a route recorded with a non-2xx status is never chosen', () => {
  assert.equal(chooseHealthPath({ '/gone': { initialStatus: 410, dataRoute: '/gone.rsc' } }), null)
})

test('an internal segment deeper in the path is excluded too', () => {
  assert.equal(
    chooseHealthPath({ '/docs/_draft': { dataRoute: '/docs/_draft.rsc' }, '/docs': { dataRoute: '/docs.rsc' } }),
    '/docs'
  )
})

test('a page is preferred over a prerendered file, even when the file sorts first', () => {
  assert.equal(chooseHealthPath({ '/favicon.ico': {}, '/isr': { dataRoute: '/isr.rsc' } }), '/isr')
})

test('a prerendered file is used when no page is available', () => {
  assert.equal(chooseHealthPath({ '/favicon.ico': {} }), '/favicon.ico')
})

test('the same routes in any order choose the same path', () => {
  assert.equal(chooseHealthPath({ '/b': { dataRoute: '/b.rsc' }, '/a': { dataRoute: '/a.rsc' } }), '/a')
  assert.equal(chooseHealthPath({ '/a': { dataRoute: '/a.rsc' }, '/b': { dataRoute: '/b.rsc' } }), '/a')
})
