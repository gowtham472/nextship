/**
 * @nextship/cli: terminal logo
 *
 * The NextShip logo drawn in character cells: the gold block N on the blue light
 * burst, with the wordmark and tagline beneath it, laid out as in
 * `brand/nextship-logo.png`. Each cell holds two pixels: an upper half block whose
 * foreground is the top pixel and whose background is the bottom one, which makes
 * the pixels square in a cell twice as tall as it is wide.
 *
 * Author: Gowtham
 * Rules: ../../../AGENTS.md §4.3
 */

export type ColorDepth = 8 | 24

type Rgb = readonly [number, number, number]

/**
 * The N, one character per pixel, `#` for gold. Measured from the artwork at about
 * 18.5 artwork pixels to one terminal pixel, then snapped to whole pixels by hand:
 * the gaps, notches and stair pieces are one to three pixels wide at this size, and
 * sampling the artwork directly drops some of them and thickens others.
 */
const MARK = [
  '###########..............###########',
  '###########..............###########',
  '###########..............###########',
  '###########..............###########',
  '###########..............###########',
  '###########..............###########',
  '###########..............###########',
  '###########..............###########',
  '###########..............###########',
  '#########................###########',
  '#########................###########',
  '....................................',
  '#########......##........###########',
  '#########......##........###########',
  '#########......##........###########',
  '###########.#####........###########',
  '###########.#####........###########',
  '###########..............###########',
  '###########.......#####..###########',
  '###########.......#####..###########',
  '###########.......##.......#########',
  '###########.......##.......#########',
  '###########.......##.......#########',
  '....................................',
  '###########................#########',
  '###########................#########',
  '###########.................########',
  '###########..................#######',
  '###########...................######',
  '###########....................#####',
  '###########.....................####',
  '###########......................###',
  '###########.......................##',
  '###########........................#',
  '###########.........................',
]

/** Panel size in cells, and the N's top left corner in pixels. */
const COLUMNS = 56
const ROWS = 27
const MARK_LEFT = 10
const MARK_TOP = 6

/** Leading spaces, matching the indent of every other line the CLI prints. */
const INDENT = '  '

/** The centre of the light burst, as a fraction of the panel's width and height. */
const BURST: readonly [number, number] = [0.5, 0.48]

/**
 * The burst, fitted to the artwork's ground as luma by direction plus luma by
 * distance from `BURST`, which accounts for three quarters of its variation; the
 * rest is grain and fine streaks. `BY_ANGLE` holds an offset for every 10 degrees
 * clockwise from pointing right, `BY_RADIUS` a level for every 0.05 of the panel
 * outwards, each at the centre of its span.
 */
const BY_ANGLE = [
  -19, -13, -9, -14, -48, -49, -21, -11, 10, 16, 8, 16, -1, -19, -34, -43, -41, -15, 23, -7, -18, -4, 27, 70, 47, 93,
  39, -11, -26, -23, -16, -2, 31, 44, 15, 4,
]
const BY_RADIUS = [80, 101, 100, 93, 87, 86, 85, 86, 90, 90, 89, 91, 88, 80, 65]

/** The artwork's colour at each luma, averaged over its ground and over the N. */
const GROUND: ReadonlyArray<readonly [number, Rgb]> = [
  [14, [0, 8, 174]],
  [38, [0, 33, 196]],
  [54, [1, 55, 204]],
  [69, [6, 73, 208]],
  [80, [14, 85, 214]],
  [91, [22, 99, 220]],
  [105, [35, 114, 224]],
  [122, [53, 132, 229]],
  [158, [96, 168, 239]],
  [192, [141, 201, 246]],
]
const GOLD: ReadonlyArray<readonly [number, Rgb]> = [
  [50, [222, 164, 0]],
  [95, [255, 196, 0]],
  [160, [255, 238, 0]],
]

/** Film grain amplitude per channel, enough to read as the artwork's texture. */
const GRAIN = 6

interface TextLine {
  row: number
  text: string
  from: Rgb
  to: Rgb
  bold: boolean
}

/**
 * The wordmark and tagline in the artwork's colours. The artwork sets the wordmark at
 * twice the tagline's size, which a terminal cannot, so letter spacing gives it back
 * some of its width. The tagline is lifted from the artwork's darkest blues, which
 * sit on the panel at a contrast a terminal font cannot be read at.
 */
const TEXT: readonly TextLine[] = [
  { row: 23, text: 'N e x t S h i p', from: [23, 195, 255], to: [45, 228, 255], bold: true },
  { row: 25, text: 'Ship Next.js Anywhere with Deployment Intelligence', from: [94, 176, 255], to: [110, 150, 255], bold: false },
]

/**
 * The colour depth to draw the logo in, or null when this terminal cannot show it as
 * drawn. A pipe, `NO_COLOR`, a 16 colour terminal and a window too narrow to hold the
 * panel all get null, because a wrapped or flattened logo reads as a broken one.
 */
export function logoDepth(terminal: {
  isTTY: boolean
  columns: number
  colorDepth: number
  noColor: boolean
}): ColorDepth | null {
  if (!terminal.isTTY || terminal.noColor || terminal.columns < INDENT.length + COLUMNS) return null
  if (terminal.colorDepth >= 24) return 24
  if (terminal.colorDepth >= 8) return 8
  return null
}

/** The logo as terminal text, one line per row, each ending with a colour reset. */
export function renderLogo(depth: ColorDepth): string {
  // The 256 colour palette's blues are far enough apart that a gradient quantized
  // directly breaks into flat bands, so there every panel colour is dithered first.
  const panel = (layer: 38 | 48, color: Rgb, x: number, y: number) =>
    sgr(depth, layer, depth === 8 ? dither(color, x, y) : color)
  const lines: string[] = []
  for (let row = 0; row < ROWS; row++) {
    const text = TEXT.find((line) => line.row === row)
    const start = text ? Math.floor((COLUMNS - text.text.length) / 2) : 0
    let line = INDENT
    let active = ''
    for (let x = 0; x < COLUMNS; x++) {
      const top = pixel(x, row * 2)
      const bottom = pixel(x, row * 2 + 1)
      let glyph: string
      let codes: string[]
      const index = x - start
      if (text && index >= 0 && index < text.text.length) {
        const color = mix(text.from, text.to, index / (text.text.length - 1))
        glyph = text.text[index]
        codes = [...(text.bold ? ['1'] : []), sgr(depth, 38, color), panel(48, mix(top, bottom, 0.5), x, row * 2)]
      } else if (text) {
        glyph = ' '
        codes = [panel(48, mix(top, bottom, 0.5), x, row * 2)]
      } else {
        glyph = '▀'
        codes = [panel(38, top, x, row * 2), panel(48, bottom, x, row * 2 + 1)]
      }
      const code = codes.join(';')
      if (code !== active) {
        // Bold persists until reset, so leaving the wordmark has to clear it
        // rather than only change the colours.
        line += `${active.startsWith('1;') && !code.startsWith('1;') ? '\x1b[0m' : ''}\x1b[${code}m`
        active = code
      }
      line += glyph
    }
    lines.push(`${line}\x1b[0m`)
  }
  return `${lines.join('\n')}\n`
}

function pixel(x: number, y: number): Rgb {
  const luma = burst((x + 0.5) / COLUMNS, (y + 0.5) / (ROWS * 2))
  const gold = MARK[y - MARK_TOP]?.[x - MARK_LEFT] === '#'
  return lift(ramp(gold ? GOLD : GROUND, luma), GRAIN * grain(x, y))
}

/**
 * The burst's luma at a point. The rays fade in over the first fifth of the way out,
 * leaving the core evenly bright as the artwork's is, and are sharpened by a fifth
 * to restore the contrast a 10 degree average spreads out. The lowest fifth is
 * dimmed as in the artwork, which keeps the text rows dark enough to read.
 */
function burst(u: number, v: number): number {
  const du = u - BURST[0]
  const dv = v - BURST[1]
  const radius = Math.hypot(du, dv)
  const angle = ((Math.atan2(dv, du) * 180) / Math.PI + 360) % 360
  const rays = 1.2 * sample(BY_ANGLE, angle / 10, true) * smoothstep(0, 0.2, radius)
  const luma = sample(BY_RADIUS, radius / 0.05, false) + rays
  return 14 + (luma - 14) * (1 - 0.55 * smoothstep(0.7, 0.95, v))
}

/** Linear interpolation between bin centres; `wrap` joins the last bin to the first. */
function sample(table: readonly number[], position: number, wrap: boolean): number {
  const at = position - 0.5
  const i = Math.floor(at)
  const n = table.length
  const bin = (k: number) => table[wrap ? ((k % n) + n) % n : Math.min(n - 1, Math.max(0, k))]
  return bin(i) + (bin(i + 1) - bin(i)) * (at - i)
}

function ramp(stops: ReadonlyArray<readonly [number, Rgb]>, luma: number): Rgb {
  const next = stops.findIndex(([at]) => at >= luma)
  if (next === 0) return stops[0][1]
  if (next === -1) return stops[stops.length - 1][1]
  const [from, low] = stops[next - 1]
  const [to, high] = stops[next]
  return mix(low, high, (luma - from) / (to - from))
}

/** A value in -1..1 from an integer hash, so the grain is identical on every run. */
function grain(x: number, y: number): number {
  let h = Math.imul(x * 374761393 + y * 668265263, 1274126177)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) & 0xff) / 127.5 - 1
}

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]

/**
 * A 4x4 ordered dither of up to 12% of each channel. Scaling rather than offsetting
 * keeps the hue: an equal offset pushes a blue's small red channel across the
 * palette's first step, 0 to 95, and speckles the ground violet.
 */
function dither(color: Rgb, x: number, y: number): Rgb {
  const scale = 1 + ((BAYER[(y % 4) * 4 + (x % 4)] + 0.5) / 16 - 0.5) * 0.24
  return color.map((value) => Math.min(255, Math.round(value * scale))) as unknown as Rgb
}

function sgr(depth: ColorDepth, layer: 38 | 48, color: Rgb): string {
  return depth === 24 ? `${layer};2;${color.join(';')}` : `${layer};5;${palette256(color)}`
}

/**
 * The xterm 256 colour entries the logo is drawn from: blues for the ground, golds
 * for the N and cyans for the text. Nearest colour over the whole palette turns the
 * light blues violet, because the colour cube has no red level between 0 and 95.
 */
const PALETTE = [17, 18, 19, 20, 21, 25, 26, 27, 31, 32, 33, 38, 39, 45, 51, 74, 75, 81, 110, 116, 117, 153, 178, 214, 220, 221, 226]

function palette256([r, g, b]: Rgb): number {
  let nearest = PALETTE[0]
  let error = Infinity
  for (const index of PALETTE) {
    const [pr, pg, pb] = cubeColor(index)
    const candidate = (pr - r) ** 2 + (pg - g) ** 2 + (pb - b) ** 2
    if (candidate < error) {
      nearest = index
      error = candidate
    }
  }
  return nearest
}

/** The colour of an entry in the 6x6x6 cube, whose levels are 0, 95, 135, 175, 215 and 255. */
function cubeColor(index: number): Rgb {
  const levels = [0, 95, 135, 175, 215, 255]
  const n = index - 16
  return [levels[Math.floor(n / 36)], levels[Math.floor(n / 6) % 6], levels[n % 6]]
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t)) as unknown as Rgb
}

function lift(color: Rgb, amount: number): Rgb {
  return color.map((value) => Math.min(255, Math.max(0, Math.round(value + amount)))) as unknown as Rgb
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp((value - edge0) / (edge1 - edge0))
  return t * t * (3 - 2 * t)
}
