/**
 * @nextship/cli: server host key trust
 *
 * The first `nextship server add` is the one moment nextship has to trust a key
 * it has never seen, so it happens in the open: the key is scanned, its SHA256
 * fingerprint is printed in the plan, and `--yes` is the confirmation. From then
 * on the full key line lives in `nextship.json` and every connection checks
 * against it, so a server that presents a different key is refused rather than
 * prompted about. A prompt on a CI runner is a hang; a prompt a person clicks
 * through is no check at all.
 *
 * The fingerprint is computed here rather than by `ssh-keygen -lf`, because it
 * is the value a user compares against their provider's console, and the
 * computation is small enough to pin with a test: base64 of the SHA256 of the
 * decoded key blob, without padding, exactly as OpenSSH prints it.
 *
 * Author: Ragul D
 * Design: ../../../../../docs/design.md §9.3
 */

import { createHash } from 'node:crypto'
import { NextshipError } from '../../errors.js'
import { captureStrict } from '../../util/exec.js'

/** Key types in order of preference. ed25519 first: smallest, fastest, no parameter choices to get wrong. */
const PREFERRED_TYPES = ['ssh-ed25519', 'ecdsa-sha2-nistp256', 'ecdsa-sha2-nistp384', 'ecdsa-sha2-nistp521', 'ssh-rsa']

export interface HostKey {
  type: string
  /** The base64 key blob. */
  key: string
}

/**
 * The key types in `ssh-keyscan` output, ignoring its comment lines and any
 * type nextship does not recognise.
 */
export function parseKeyscan(output: string): HostKey[] {
  const keys: HostKey[] = []
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const parsed = parseKeyLine(trimmed)
    if (parsed && PREFERRED_TYPES.includes(parsed.type)) keys.push(parsed)
  }
  return keys
}

/** `host type key` or `type key`, as `ssh-keyscan` and `nextship.json` hold them. */
export function parseKeyLine(line: string): HostKey | null {
  const fields = line.trim().split(/\s+/)
  const typeIndex = fields.findIndex((field) => PREFERRED_TYPES.includes(field))
  if (typeIndex === -1 || typeIndex > 1) return null
  const key = fields[typeIndex + 1]
  if (!key || !/^[A-Za-z0-9+/]+={0,3}$/.test(key)) return null
  return { type: fields[typeIndex], key }
}

/** The strongest key the server offered. */
export function preferredKey(keys: HostKey[]): HostKey | null {
  for (const type of PREFERRED_TYPES) {
    const match = keys.find((entry) => entry.type === type)
    if (match) return match
  }
  return null
}

/** `SHA256:...` as `ssh-keygen -lf` and every provider console print it. */
export function fingerprint(key: HostKey): string {
  const digest = createHash('sha256').update(Buffer.from(key.key, 'base64')).digest('base64')
  return `SHA256:${digest.replace(/=+$/, '')}`
}

/**
 * The `HostKeyAlgorithms` that make ssh negotiate the pinned key.
 *
 * Without it a server offering several key types can present one that is not in
 * the pinned known_hosts file, and strict checking then refuses a server whose
 * pinned key never changed. An RSA key is negotiated through the SHA-2 signature
 * algorithms, since OpenSSH disabled `ssh-rsa` (SHA-1) signatures by default.
 */
export function hostKeyAlgorithms(key: HostKey): string {
  return key.type === 'ssh-rsa' ? 'rsa-sha2-512,rsa-sha2-256' : key.type
}

/** A known_hosts line for the alias every connection uses, so the file never depends on how the host was spelled. */
export function knownHostsLine(alias: string, key: HostKey): string {
  return `${alias} ${key.type} ${key.key}\n`
}

/** Reads the server's host key over the network, for trust on first use. */
export async function scanHostKey(host: string, port: number): Promise<HostKey> {
  let output: string
  try {
    output = await captureStrict('ssh-keyscan', ['-T', '15', '-t', 'ed25519,ecdsa,rsa', '-p', String(port), host], {
      cwd: process.cwd(),
      env: process.env,
    })
  } catch (error) {
    throw new NextshipError(
      `Could not read the host key of ${host}:${port}.`,
      `Check that the server is up and that SSH listens on port ${port}. ${error instanceof Error ? error.message : ''}`.trim()
    )
  }

  const key = preferredKey(parseKeyscan(output))
  if (!key) {
    throw new NextshipError(
      `${host}:${port} offered no host key nextship recognises.`,
      'Check that the address is an SSH server. nextship accepts ed25519, ECDSA and RSA host keys.'
    )
  }
  return key
}
