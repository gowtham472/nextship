/**
 * @nextship/cli: tests for rendering an app's Caddy site
 *
 * The site file decides whether streaming survives the proxy and which names an
 * app answers for, so both are pinned rather than left to a live check.
 *
 * Author: Ragul D
 * Design: ../../../../../docs/design.md §9.3
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderSite } from './caddy.js'

const base = { name: 'demo', container: 'demo-r20260915-100000-abcdef', domains: [], isDefault: false }

test('the default app with no domain answers plain HTTP on port 80, streaming unbuffered', () => {
  assert.equal(
    renderSite({ ...base, isDefault: true }),
    [
      '# Written by nextship for demo. Regenerated on every deployment; edits are overwritten.',
      'http://:80 {',
      '  reverse_proxy demo-r20260915-100000-abcdef:3000 {',
      '    flush_interval -1',
      '    lb_try_duration 5s',
      '  }',
      '}',
      '',
    ].join('\n')
  )
})

test('an app that is not the default and has no domain answers nothing', () => {
  assert.doesNotMatch(renderSite(base), /\{/)
})

test('one domain gets its own HTTPS site with the minimum TLS version', () => {
  const site = renderSite({ ...base, domains: [{ domain: 'app.example.com', primary: true, minimumTls: '1.2' }] })
  assert.match(site, /^app\.example\.com \{\n  tls \{\n    protocols tls1\.2\n  \}\n  reverse_proxy demo-r20260915-100000-abcdef:3000 \{\n    flush_interval -1/m)
  assert.doesNotMatch(site, /http:\/\/:80/)
})

test('several domains share a block per minimum TLS version, primary first', () => {
  const site = renderSite({
    ...base,
    isDefault: true,
    domains: [
      { domain: 'www.example.com', primary: false, minimumTls: '1.2' },
      { domain: 'example.com', primary: true, minimumTls: '1.2' },
      { domain: 'secure.example.com', primary: false, minimumTls: '1.3' },
    ],
  })
  assert.match(site, /^example\.com, www\.example\.com \{\n  tls \{\n    protocols tls1\.2/m)
  assert.match(site, /^secure\.example\.com \{\n  tls \{\n    protocols tls1\.3/m)
  assert.match(site, /^http:\/\/:80 \{/m, 'the default app keeps its address after gaining domains')
  assert.equal(site.match(/flush_interval -1/g)?.length, 3)
})

test('a name that could break out of the site file is refused', () => {
  assert.throws(() => renderSite({ ...base, domains: [{ domain: 'x.com {\n}', primary: true, minimumTls: '1.2' }] }))
  assert.throws(() => renderSite({ ...base, name: 'demo {' }))
})
