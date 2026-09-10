import { test } from 'node:test'
import assert from 'node:assert/strict'

import { logoDepth, renderLogo } from './logo.js'

const SGR = /\x1b\[[\d;]*m/g

function lines(depth: 8 | 24): string[] {
  return renderLogo(depth).split('\n').filter((line) => line.length > 0)
}

function visible(line: string): string {
  return line.replace(SGR, '')
}

const width = [...visible(lines(24)[0])].length
const terminal = { isTTY: true, columns: width, colorDepth: 24, noColor: false }

test('every line is the same width, so the panel stays rectangular', () => {
  for (const depth of [8, 24] as const) {
    const widths = new Set(lines(depth).map((line) => [...visible(line)].length))
    assert.deepEqual([...widths], [width], `depth ${depth}`)
  }
})

test('every line ends with a reset, so the panel colour cannot bleed into the prompt', () => {
  for (const depth of [8, 24] as const) {
    for (const line of lines(depth)) assert.ok(line.endsWith('\x1b[0m'), JSON.stringify(line.slice(-12)))
  }
})

test('256 colour output uses the palette only, never a sequence that terminal would misread', () => {
  const out = renderLogo(8)
  assert.doesNotMatch(out, /[34]8;2;/)
  for (const [, index] of out.matchAll(/[34]8;5;(\d+)/g)) {
    const n = Number(index)
    assert.ok(n >= 16 && n <= 255, `palette index ${n}`)
  }
  assert.doesNotMatch(renderLogo(24), /[34]8;5;/)
})

test('the wordmark and tagline are real text, not pixels', () => {
  const text = lines(24).map(visible)
  assert.ok(text.some((line) => line.includes('N e x t S h i p')))
  assert.ok(text.some((line) => line.includes('Ship Next.js Anywhere with Deployment Intelligence')))
})

test('bold ends with the wordmark rather than running on into the tagline', () => {
  const wordmark = lines(24).find((line) => visible(line).includes('N e x t S h i p'))
  assert.ok(wordmark)
  const afterWordmark = wordmark.slice(wordmark.lastIndexOf('p') + 1)
  assert.match(afterWordmark, /^\x1b\[0m\x1b\[48;/)
})

test('the logo is drawn in a truecolor or 256 colour terminal wide enough to hold it', () => {
  assert.equal(logoDepth(terminal), 24)
  assert.equal(logoDepth({ ...terminal, colorDepth: 8 }), 8)
})

test('the logo is not drawn where it would be flattened, wrapped or unwanted', () => {
  assert.equal(logoDepth({ ...terminal, isTTY: false }), null)
  assert.equal(logoDepth({ ...terminal, noColor: true }), null)
  assert.equal(logoDepth({ ...terminal, colorDepth: 4 }), null)
  assert.equal(logoDepth({ ...terminal, columns: width - 1 }), null)
})
