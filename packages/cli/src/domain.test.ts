/**
 * Tests for custom domain handling.
 *
 * The spec is replaced wholesale on every update, so these lean on what must
 * survive an edit as much as on what must change.
 *
 * Author: Gowtham
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateDomain } from './domain.js'
import {
  addDomainToSpec,
  effectiveRole,
  removeDomainFromSpec,
  specDomains,
} from './targets/digitalocean-spec.js'
import { NextshipError } from './errors.js'

const alias = (domain: string) => ({ domain, type: 'ALIAS' as const, minimum_tls_version: '1.2' })
const primary = (domain: string) => ({ domain, type: 'PRIMARY' as const, minimum_tls_version: '1.2' })

function rejects(run: () => unknown, fragment: string): void {
  assert.throws(run, (error: unknown) => {
    assert.ok(error instanceof NextshipError, 'expected a NextshipError')
    assert.match(error.message, new RegExp(fragment, 'i'))
    assert.ok(error.action.length > 0, 'every error carries a next action')
    return true
  })
}

// ------------------------------------------------------------------ validation

test('a hostname is accepted', () => {
  validateDomain('app.example.com')
  validateDomain('example.com')
})

test('a pasted URL is rejected by name, because it is the common mistake', () => {
  rejects(() => validateDomain('https://preview.example.com'), 'looks like a URL')
  rejects(() => validateDomain('preview.example.com/path'), 'looks like a URL')
})

test('a platform domain is refused, whichever target it belongs to', () => {
  rejects(() => validateDomain('acme-web-a1b2c.ondigitalocean.app'), 'platform domain')
  rejects(() => validateDomain('abc123.awsapprunner.com'), 'platform domain')
})

test('malformed names are refused', () => {
  rejects(() => validateDomain('no-dots'), 'not a valid domain')
  rejects(() => validateDomain('-leading.example.com'), 'not a valid domain')
  rejects(() => validateDomain('spaces in.example.com'), 'not a valid domain')
  rejects(() => validateDomain(' preview.example.com'), 'whitespace')
  rejects(() => validateDomain(''), 'empty')
})

// ----------------------------------------------------------------------- add

test('a domain is added without disturbing the rest of the spec', () => {
  const spec = {
    name: 'portfolio',
    region: 'blr',
    ingress: { rules: [{ match: { path: { prefix: '/' } } }] },
    services: [{ name: 'web' }],
  }

  const updated = addDomainToSpec(spec, alias('preview.example.com'))

  assert.deepEqual(updated.ingress, spec.ingress, 'ingress survives')
  assert.deepEqual(updated.services, spec.services, 'the service survives')
  assert.equal((updated.domains as unknown[]).length, 1)
})

test('zone is never set, because DigitalOcean does not manage this DNS', () => {
  const updated = addDomainToSpec({}, alias('preview.example.com'))
  const entry = (updated.domains as Record<string, unknown>[])[0]

  assert.ok(!('zone' in entry), 'setting zone would make App Platform expect to own records it cannot see')
})

test('adding a domain twice is refused', () => {
  const spec = addDomainToSpec({}, alias('preview.example.com'))
  rejects(() => addDomainToSpec(spec, alias('preview.example.com')), 'already attached')
})

test('a second domain joins the first rather than replacing it', () => {
  const spec = addDomainToSpec({}, alias('one.example.com'))
  const updated = addDomainToSpec(spec, alias('two.example.com'))

  assert.deepEqual(specDomains(updated).map((entry) => entry.domain), ['one.example.com', 'two.example.com'])
})

test('promoting a new primary demotes the old one, since only one may be primary', () => {
  const spec = { domains: [primary('old.example.com'), alias('other.example.com')] }
  const updated = addDomainToSpec(spec, primary('new.example.com'))

  const byName = new Map(specDomains(updated).map((entry) => [entry.domain, entry.type]))
  assert.equal(byName.get('new.example.com'), 'PRIMARY')
  assert.equal(byName.get('old.example.com'), 'ALIAS', 'two primaries would be rejected by the API')
  assert.equal(byName.get('other.example.com'), 'ALIAS')
})

test('adding an alias leaves an existing primary alone', () => {
  const spec = { domains: [primary('main.example.com')] }
  const updated = addDomainToSpec(spec, alias('extra.example.com'))

  assert.equal(specDomains(updated).find((e) => e.domain === 'main.example.com')?.type, 'PRIMARY')
})

// -------------------------------------------------------------------- remove

test('only the named domain is removed', () => {
  const spec: Record<string, unknown> = { domains: [alias('a.example.com'), alias('b.example.com')], ingress: { rules: [] } }
  const updated = removeDomainFromSpec(spec, 'a.example.com')

  assert.deepEqual(specDomains(updated).map((entry) => entry.domain), ['b.example.com'])
  assert.deepEqual(updated.ingress, spec.ingress, 'unrelated spec fields survive a removal')
})

test('removing a domain that is not attached is refused', () => {
  rejects(() => removeDomainFromSpec({ domains: [alias('a.example.com')] }, 'b.example.com'), 'not attached')
})

// -------------------------------------------------------------------- others

test('a spec with no domains reads as empty rather than throwing', () => {
  assert.deepEqual(specDomains(null), [])
  assert.deepEqual(specDomains({}), [])
  assert.deepEqual(specDomains({ domains: [{ notADomain: true }] }), [])
})


/**
 * Role promotion.
 *
 * Found by running it: a spec sending ALIAS for the only custom domain came back
 * from App Platform stored as PRIMARY, while the plan had told the user "alias".
 */
test('the first custom domain is primary whatever was asked for', () => {
  assert.equal(effectiveRole(0, false), 'PRIMARY', 'App Platform promotes it regardless')
  assert.equal(effectiveRole(0, true), 'PRIMARY')
})

test('a later domain is an alias unless promotion is asked for', () => {
  assert.equal(effectiveRole(1, false), 'ALIAS')
  assert.equal(effectiveRole(3, false), 'ALIAS')
  assert.equal(effectiveRole(1, true), 'PRIMARY')
})
