/**
 * @nextship/cli: tests for host key parsing and fingerprints
 *
 * The fingerprint is what a person compares against their provider's console
 * before trusting a server, so it has to match OpenSSH exactly. The expected
 * values below were printed by `ssh-keygen -lf` for the same keys.
 *
 * Author: Ragul D
 * Design: ../../../../../docs/design.md §9.3
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fingerprint, hostKeyAlgorithms, knownHostsLine, parseKeyLine, parseKeyscan, preferredKey } from './host-key.js'

const ED25519 = 'AAAAC3NzaC1lZDI1NTE5AAAAIBAzLBUdetTLzoVHIVLcV5jAUBaPHnXQVkBwGe8ZAFq1'
const RSA =
  'AAAAB3NzaC1yc2EAAAADAQABAAABAQC+Y0X+uasKfTlFdQJ3DZ1P6IMubDn13j1s1qzsy1PvyewIimCF0/m05NBEsEy9jAT83AtOb6UFXtwdMYvovjFL3/1nkuSvKhPhZn6aouDxyipQhgU+g2IGhNBMd2mt1bJ8RFFYR7VMSB0m+EY/ujzQdtFo6i7sECp+aP5sY9eYoaGdrojKeqOPsD3MGei7Lx2Y2F8TKdAbHTkCH44ho40en0xvmR6h+t3aWgHV9M/gBVLTL8xDD3dv/YzSefkz1lonn0wjerdkrVVHSToCkQFX1Uk4vbS/VpStiOKQHJv5B3zS4UxbQqnP5f4Pjpn+EdhZFblz/7Cjy9s2Sfo28gSh'

const keyscan = [
  '# 203.0.113.10:22 SSH-2.0-OpenSSH_9.6p1 Ubuntu-3ubuntu13.19',
  `203.0.113.10 ssh-rsa ${RSA}`,
  '# 203.0.113.10:22 SSH-2.0-OpenSSH_9.6p1 Ubuntu-3ubuntu13.19',
  `203.0.113.10 ssh-ed25519 ${ED25519}`,
  '',
].join('\n')

test('fingerprints match ssh-keygen -lf for ed25519 and RSA keys', () => {
  assert.equal(fingerprint({ type: 'ssh-ed25519', key: ED25519 }), 'SHA256:PEAn0mP9alYc0qaVa3RssukBYCLu7hXsnMWCBtZ/jwM')
  assert.equal(fingerprint({ type: 'ssh-rsa', key: RSA }), 'SHA256:4aNV1xDPKh7veBDGNyqqnLdEzo13TgD3AXzXKr8w2Gw')
})

test('keyscan output is parsed past its comment lines, and ed25519 is preferred over RSA', () => {
  const keys = parseKeyscan(keyscan)
  assert.equal(keys.length, 2)
  assert.deepEqual(preferredKey(keys), { type: 'ssh-ed25519', key: ED25519 })
})

test('a bracketed host with a port parses like any other', () => {
  assert.deepEqual(parseKeyLine(`[127.0.0.1]:2222 ssh-ed25519 ${ED25519}`), { type: 'ssh-ed25519', key: ED25519 })
})

test('lines that are not keys are refused rather than half read', () => {
  assert.equal(parseKeyLine('203.0.113.10 ssh-dss AAAAB3NzaC1kc3M'), null)
  assert.equal(parseKeyLine('ssh-ed25519'), null)
  assert.equal(parseKeyLine(`host ssh-ed25519 not;base64`), null)
  assert.equal(parseKeyLine(`a b ssh-ed25519 ${ED25519}`), null, 'the type must be the first or second field')
  assert.equal(preferredKey(parseKeyscan('# nothing but comments\n')), null)
})

// Without pinning the algorithm, a server that also has an ECDSA key can present
// that one, and strict checking refuses a server whose pinned key never changed.
test('the negotiated algorithm is the pinned key type, with SHA-2 signatures for RSA', () => {
  assert.equal(hostKeyAlgorithms({ type: 'ssh-ed25519', key: ED25519 }), 'ssh-ed25519')
  assert.equal(hostKeyAlgorithms({ type: 'ssh-rsa', key: RSA }), 'rsa-sha2-512,rsa-sha2-256')
})

test('the known_hosts line names the alias, not the host', () => {
  assert.equal(knownHostsLine('nextship-server', { type: 'ssh-ed25519', key: ED25519 }), `nextship-server ssh-ed25519 ${ED25519}\n`)
})
