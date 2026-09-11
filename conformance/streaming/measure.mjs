#!/usr/bin/env node
/**
 * Streaming conformance: fails unless a response streams.
 *
 * Requests the fixture's /stream page, whose shell renders at once and whose tail
 * waits two seconds behind a Suspense boundary, and asserts three things: the first
 * byte arrives well before the last, the shell is among the bytes that arrive first,
 * and the tail is not. A proxy that buffers the response fails however fast it is,
 * because the whole page then arrives at once. That is the failure design.md §11
 * exists to catch: PPR and Suspense keep working, and deliver none of the benefit.
 *
 * It takes the page's URL, so the same check runs against a local container and
 * against any deployed target.
 *
 * Author: Gowtham
 */

const url = process.argv[2]
if (!url) {
  console.error('Usage: node measure.mjs <url of the fixture /stream page>')
  process.exit(2)
}

/** The tail waits 2000 ms; the whole response must take at least most of that. */
const MIN_TOTAL_MS = 1800
/** The shell must arrive well inside that wait, allowing for a remote target's latency. */
const MAX_FIRST_BYTE_MS = 1000
/** A target that never answers fails the check instead of hanging whatever runs it. */
const GIVE_UP_MS = 30_000

const started = performance.now()
const response = await fetch(url, {
  headers: { 'cache-control': 'no-cache' },
  signal: AbortSignal.timeout(GIVE_UP_MS),
}).catch((error) => {
  console.error(`streaming: FAIL, ${url} did not answer: ${error.message}`)
  process.exit(1)
})
if (!response.ok || !response.body) {
  console.error(`streaming: ${url} answered ${response.status}`)
  process.exit(1)
}

const decoder = new TextDecoder()
let firstByteMs = null
let early = ''
let body = ''
try {
  for await (const chunk of response.body) {
    const now = performance.now() - started
    firstByteMs ??= now
    const text = decoder.decode(chunk, { stream: true })
    body += text
    // Everything that arrived before the tail could have been rendered.
    if (now < MIN_TOTAL_MS - 500) early += text
  }
} catch (error) {
  console.error(`streaming: FAIL, the response stopped part way: ${error.message}`)
  process.exit(1)
}
const totalMs = performance.now() - started

const failures = []
if (!body.includes('stream-shell') || !body.includes('stream-tail')) {
  failures.push('the page is not the fixture: shell or tail missing from the body')
}
if (totalMs < MIN_TOTAL_MS) {
  failures.push(`the whole response took ${Math.round(totalMs)} ms, so the slow boundary did not wait`)
}
if (firstByteMs > MAX_FIRST_BYTE_MS) {
  failures.push(`the first byte took ${Math.round(firstByteMs)} ms, so the response was held back`)
}
if (!early.includes('stream-shell')) failures.push('the shell did not arrive before the tail was ready')
if (early.includes('stream-tail')) failures.push('the tail arrived early, so this did not measure streaming')

const summary = `first byte ${Math.round(firstByteMs)} ms, last byte ${Math.round(totalMs)} ms`
if (failures.length > 0) {
  console.error(`streaming: FAIL (${summary})`)
  for (const failure of failures) console.error(`  ${failure}`)
  process.exit(1)
}
console.log(`streaming: ok, ${summary}, shell before tail`)
