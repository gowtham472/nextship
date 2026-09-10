/**
 * Tests for the DigitalOcean target.
 *
 * The region test exists because of a real failure: the app region `blr` was
 * passed to the registry API, which only accepts datacenter slugs like `blr1`,
 * and the create was rejected. Two namespaces that look alike.
 *
 * Author: Gowtham
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildAppSpec, deploymentInProgress, matchRegistryRegion, mergeAppSpec, summarizeDeployment } from './digitalocean.js'

/** Exactly what the API returned, order included. */
const AVAILABLE = ['ric1', 'fra1', 'ams3', 'nyc3', 'sfo3', 'sgp1', 'syd1', 'blr1', 'sfo2', 'atl1', 'tor1', 'lon1', 'mkc1']

test('maps an app region to the registry region for the same city', () => {
  assert.equal(matchRegistryRegion('blr', AVAILABLE), 'blr1')
  assert.equal(matchRegistryRegion('nyc', AVAILABLE), 'nyc3')
  assert.equal(matchRegistryRegion('fra', AVAILABLE), 'fra1')
})

test('prefers the first listed datacenter where a city has several', () => {
  assert.equal(matchRegistryRegion('sfo', AVAILABLE), 'sfo3', 'sfo3 is listed before sfo2')
})

test('returns null rather than guessing when no city matches', () => {
  assert.equal(matchRegistryRegion('xyz', AVAILABLE), null)
})

test('an already-suffixed region does not match, since app regions never carry digits', () => {
  assert.equal(matchRegistryRegion('blr1', AVAILABLE), null)
})

test('the app spec pins one instance and a health check App Platform will actually use', () => {
  const spec = buildAppSpec({
    name: 'demo',
    region: 'blr',
    repository: 'demo',
    tag: 'dpl-abc',
    port: 3000,
    instanceSize: 'apps-s-1vcpu-0.5gb',
  })

  assert.equal(spec.region, 'blr')
  const service = spec.services[0]
  assert.deepEqual(service.image, { registry_type: 'DOCR', repository: 'demo', tag: 'dpl-abc' })
  assert.equal(service.http_port, 3000)
  // More than one would diverge without the shared cache handler, which is v2.
  assert.equal(service.instance_count, 1)
  assert.ok(service.health_check.initial_delay_seconds >= 20, 'the image pull needs longer than the boot')
})

/**
 * Deployment summaries.
 *
 * The fixture below is copied from a real `GET /v2/apps/{id}/deployments`
 * response. It is shaped deliberately: `services[]` carries a digest and no
 * tag, while the tag sits in `spec.services[].image.tag`. Reading the wrong one
 * fails silently by returning null rather than throwing, which is exactly how
 * it went unnoticed until a rollback plan printed bare deployment ids.
 */
test('the image tag is read from the deployment spec, not the resolved service', () => {
  const raw = {
    id: '7d24813d-d620-444f-b701-a15c824f5cc6',
    phase: 'ACTIVE',
    cause: 'app spec updated',
    created_at: '2026-09-08T08:58:51Z',
    services: [{ name: 'web', source_image_digest: 'sha256:4999f434fcd45ab0' }],
    spec: {
      services: [
        {
          image: {
            registry_type: 'DOCR',
            registry: 'gowtham-nextship',
            repository: 'portfolio',
            tag: 'dpl-2b2c3e535f1e-de39cb34',
          },
        },
      ],
    },
  }

  const summary = summarizeDeployment(raw)
  assert.equal(summary.imageTag, 'dpl-2b2c3e535f1e-de39cb34')
  assert.equal(summary.phase, 'ACTIVE')
  assert.equal(summary.cause, 'app spec updated')
})

test('a deployment with no image in its spec summarizes without throwing', () => {
  const summary = summarizeDeployment({
    id: 'x',
    phase: 'ERROR',
    cause: 'manual',
    created_at: '2026-09-08T00:00:00Z',
  })
  assert.equal(summary.imageTag, null, 'a missing tag is reported as absent, not guessed')
})

/**
 * Spec merging.
 *
 * `PUT /apps/{id}` replaces the whole spec, so anything the request omits is
 * gone. The fixtures below are shaped from the real live app, which carries an
 * `ingress` block nextship never builds. Without merging, every deploy would
 * quietly rewrite it, and a custom domain or a second component would not
 * survive.
 */
const managedSpec = buildAppSpec({
  name: 'portfolio',
  region: 'blr',
  repository: 'portfolio',
  tag: 'dpl-new',
  port: 3000,
  instanceSize: 'apps-s-1vcpu-0.5gb',
})

test('an app with no existing spec is created from the managed spec alone', () => {
  const merged = mergeAppSpec(null, managedSpec)
  assert.equal((merged.services as any[])[0].image.tag, 'dpl-new')
})

test('fields nextship does not manage survive an update', () => {
  const existing = {
    name: 'portfolio',
    region: 'blr',
    ingress: { rules: [{ match: { path: { prefix: '/' } } }] },
    domains: [{ domain: 'example.com' }],
    alerts: [{ rule: 'DEPLOYMENT_FAILED' }],
    services: [{ name: 'web', image: { tag: 'dpl-old' } }],
  }

  const merged = mergeAppSpec(existing, managedSpec)

  assert.deepEqual(merged.ingress, existing.ingress, 'ingress is not rebuilt')
  assert.deepEqual(merged.domains, existing.domains, 'a custom domain is not dropped')
  assert.deepEqual(merged.alerts, existing.alerts, 'alerts are not dropped')
})

test('the managed fields are the ones that change', () => {
  const existing = {
    name: 'portfolio',
    region: 'blr',
    services: [{ name: 'web', image: { tag: 'dpl-old' }, instance_count: 9 }],
  }

  const service = (mergeAppSpec(existing, managedSpec).services as any[])[0]
  assert.equal(service.image.tag, 'dpl-new', 'the new image is deployed')
  assert.equal(service.instance_count, 1, 'nextship owns the instance count')
})

test('environment variables set on the service are preserved', () => {
  const existing = {
    name: 'portfolio',
    region: 'blr',
    services: [
      {
        name: 'web',
        image: { tag: 'dpl-old' },
        envs: [{ key: 'DATABASE_URL', value: 'EV[1:abc]', type: 'SECRET' }],
      },
    ],
  }

  const service = (mergeAppSpec(existing, managedSpec).services as any[])[0]
  assert.deepEqual(service.envs, existing.services[0].envs, 'runtime env survives a deploy')
})

test('the registry App Platform fills in itself is not dropped', () => {
  const existing = {
    name: 'portfolio',
    region: 'blr',
    services: [
      {
        name: 'web',
        image: { registry_type: 'DOCR', registry: 'gowtham-nextship', repository: 'portfolio', tag: 'dpl-old' },
      },
    ],
  }

  const image = (mergeAppSpec(existing, managedSpec).services as any[])[0].image
  assert.equal(image.registry, 'gowtham-nextship', 'the resolved registry survives')
  assert.equal(image.tag, 'dpl-new')
})

test('a second component added by hand is left alone', () => {
  const worker = { name: 'worker', image: { tag: 'worker-1' }, instance_count: 2 }
  const existing = {
    name: 'portfolio',
    region: 'blr',
    services: [{ name: 'web', image: { tag: 'dpl-old' } }, worker],
  }

  const services = mergeAppSpec(existing, managedSpec).services as any[]
  assert.equal(services.length, 2)
  assert.deepEqual(services[1], worker, 'nextship only ever writes its own service')
})

test('a service nextship does not find yet is added rather than replacing another', () => {
  const existing = { name: 'portfolio', region: 'blr', services: [{ name: 'worker', image: { tag: 'w' } }] }
  const services = mergeAppSpec(existing, managedSpec).services as any[]

  assert.equal(services.length, 2)
  assert.equal(services.find((s) => s.name === 'web').image.tag, 'dpl-new')
  assert.equal(services.find((s) => s.name === 'worker').image.tag, 'w', 'the unrelated one is untouched')
})

/**
 * Health check path.
 *
 * A health check polls forever, so pointing it at a route that renders on every
 * request is a cost that never stops. The build reports a prerendered route
 * when it has one.
 */
test('the health check uses the route the build reported', () => {
  const spec = buildAppSpec({
    name: 'app',
    region: 'blr',
    repository: 'app',
    tag: 'dpl-1',
    port: 3000,
    instanceSize: 'apps-s-1vcpu-0.5gb',
    healthPath: '/about',
  })

  assert.equal(spec.services[0].health_check.http_path, '/about')
})

test('a build with nothing prerendered falls back to the home page', () => {
  for (const healthPath of [null, undefined]) {
    const spec = buildAppSpec({
      name: 'app',
      region: 'blr',
      repository: 'app',
      tag: 'dpl-1',
      port: 3000,
      instanceSize: 'apps-s-1vcpu-0.5gb',
      healthPath,
    })

    assert.equal(spec.services[0].health_check.http_path, '/', 'a probe still has somewhere to go')
  }
})

// Every command that changes the app asks this first. A wrong "idle" lets a second
// write replace a release part way through; a wrong "busy" blocks every command
// until the platform clears it, so both directions are pinned.
test('an app with no unfinished deployment is idle', () => {
  assert.equal(deploymentInProgress({}), null)
  assert.equal(deploymentInProgress(undefined), null)
})

test('a deployment being built or rolled out is in progress', () => {
  assert.deepEqual(deploymentInProgress({ in_progress_deployment: { id: 'd1', phase: 'DEPLOYING' } }), {
    id: 'd1',
    phase: 'DEPLOYING',
  })
})

test('a deployment accepted but not yet started is in progress', () => {
  assert.deepEqual(deploymentInProgress({ pending_deployment: { id: 'd2' } }), { id: 'd2', phase: 'PENDING' })
})

test('a deployment reported in a finished phase does not block', () => {
  for (const phase of ['ACTIVE', 'SUPERSEDED', 'ERROR', 'CANCELED']) {
    assert.equal(deploymentInProgress({ in_progress_deployment: { id: 'd3', phase } }), null, phase)
  }
})

test('an entry without an id is ignored rather than blocking on nothing', () => {
  assert.equal(deploymentInProgress({ in_progress_deployment: { phase: 'BUILDING' } }), null)
})
