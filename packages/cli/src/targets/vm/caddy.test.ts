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

const base = { name: 'demo', container: 'demo-r20260915-100000-abcdef', domains: [], isDefault: false, previous: null, preview: false, ipCertificate: null }

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

// Next.js names the build on every request an open tab makes: the header on
// navigations and Server Actions, the query on JavaScript and CSS. A page load
// names none and must get the live build.
test('while a previous deployment runs, requests naming its build go to it first, and the rest to the live one', () => {
  const site = renderSite({
    ...base,
    isDefault: true,
    domains: [{ domain: 'app.example.com', primary: true, minimumTls: '1.2' }],
    previous: { container: 'demo-r20260915-090000-123456', deploymentId: 'dpl-aaa-111' },
  })
  const route = '  @previous expression `{header.X-Deployment-Id} == "dpl-aaa-111" || {query.dpl} == "dpl-aaa-111"`'
  assert.equal(site.split('\n').filter((line) => line === route).length, 2, 'both the address and the domain route by build')
  assert.match(
    site,
    /handle @previous \{\n    reverse_proxy demo-r20260915-090000-123456:3000 demo-r20260915-100000-abcdef:3000 \{\n      lb_policy first\n      fail_duration 30s\n      flush_interval -1/
  )
  assert.match(site, /  handle \{\n    reverse_proxy demo-r20260915-100000-abcdef:3000 \{\n      flush_interval -1/)
})

test('a deployment id that could break out of the expression is refused', () => {
  assert.throws(() => renderSite({ ...base, isDefault: true, previous: { container: 'demo-r1', deploymentId: 'dpl" || true || "' } }))
})

// A preview is the site under another name, so a crawler that finds it would index
// a copy. Crawler traffic to preview URLs is also what has run up hosting bills.
test('a preview tells crawlers not to index it, on every name it answers', () => {
  const site = renderSite({
    ...base,
    preview: true,
    domains: [
      { domain: 'pr-42.preview.example.com', primary: true, minimumTls: '1.2' },
      { domain: 'secure-pr-42.preview.example.com', primary: false, minimumTls: '1.3' },
    ],
  })
  assert.equal(site.match(/  header X-Robots-Tag "noindex, nofollow"/g)?.length, 2)
  assert.doesNotMatch(renderSite({ ...base, domains: [{ domain: 'app.example.com', primary: true, minimumTls: '1.2' }] }), /X-Robots-Tag/)
})

// Let's Encrypt certifies an IP address only with its six-day profile, and a first
// deployment should be reachable over HTTPS before any domain exists.
test('a default app on a public IPv4 address also answers HTTPS on it, with a short-lived certificate', () => {
  const site = renderSite({ ...base, isDefault: true, ipCertificate: '46.101.1.2' })
  assert.match(site, /^http:\/\/:80 \{/m, 'plain HTTP keeps working')
  assert.match(site, /^https:\/\/46\.101\.1\.2 \{\n  tls \{\n    issuer acme \{\n      profile shortlived\n    \}\n  \}\n  reverse_proxy demo-r20260915-100000-abcdef:3000 \{/m)
  assert.doesNotMatch(renderSite({ ...base, isDefault: false, ipCertificate: '46.101.1.2' }), /46\.101/, 'only the default app answers on the address')
  assert.throws(() => renderSite({ ...base, isDefault: true, ipCertificate: '46.101.1.2 {' }), /not an IPv4 address/)
})
