import { test } from 'node:test'
import assert from 'node:assert/strict'

import { logoDepth, renderLogo, type ColorDepth } from './logo.js'

const SGR = /\x1b\[[\d;]*m/g
const DEPTHS: readonly ColorDepth[] = [1, 4, 8, 24]

function lines(depth: ColorDepth): string[] {
  return renderLogo(depth).split('\n').filter((line) => line.length > 0)
}

function visible(line: string): string {
  return line.replace(SGR, '')
}

const width = [...visible(lines(24)[0])].length
const terminal = { isTTY: true, columns: width, colorDepth: 24, noColor: false }

test('every line is the same width at every colour depth, so the wordmark never shears', () => {
  for (const depth of DEPTHS) {
    const widths = new Set(lines(depth).map((line) => [...visible(line)].length))
    assert.deepEqual([...widths], [width], `depth ${depth}`)
  }
})

test('a line that sets a colour resets it, so the colour cannot bleed into the prompt', () => {
  for (const depth of DEPTHS) {
    for (const line of lines(depth)) {
      if (line.includes('\x1b[')) assert.ok(line.endsWith('\x1b[0m'), JSON.stringify(line.slice(-12)))
    }
  }
})

test('under NO_COLOR the wordmark is plain characters, with no escape sequence at all', () => {
  assert.doesNotMatch(renderLogo(1), /\x1b/)
  assert.ok(lines(1).some((line) => /[▀▄█]/.test(line)))
})

test('"Next" takes the terminal\'s own text colour, so it shows on a dark background as well as a light one', () => {
  for (const depth of [4, 8, 24] as const) {
    const out = renderLogo(depth)
    assert.match(out, /\x1b\[39m/, `depth ${depth}`)
    assert.doesNotMatch(out, /38;2;0;0;0|38;5;16m|\x1b\[30m/, `depth ${depth}`)
  }
})

test('the wordmark never paints a background, so it sits on the terminal\'s own', () => {
  for (const depth of DEPTHS) assert.doesNotMatch(renderLogo(depth), /\x1b\[(?:[\d;]*;)?(?:48|4[0-7]|10[0-7])[;m]/)
})

test('each depth uses only the sequences that depth supports', () => {
  assert.doesNotMatch(renderLogo(24), /38;5;/)
  assert.doesNotMatch(renderLogo(8), /38;2;/)
  assert.doesNotMatch(renderLogo(4), /38;[25];/)
})

test('the wordmark is drawn in any terminal wide enough, in the colour it supports', () => {
  assert.equal(logoDepth(terminal), 24)
  assert.equal(logoDepth({ ...terminal, colorDepth: 8 }), 8)
  assert.equal(logoDepth({ ...terminal, colorDepth: 4 }), 4)
  assert.equal(logoDepth({ ...terminal, colorDepth: 1 }), 1)
  assert.equal(logoDepth({ ...terminal, noColor: true }), 1)
})

test('the wordmark is not drawn into a pipe, or into a window that would wrap it', () => {
  assert.equal(logoDepth({ ...terminal, isTTY: false }), null)
  assert.equal(logoDepth({ ...terminal, columns: width - 1 }), null)
})
