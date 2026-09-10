/**
 * @nextship/cli: terminal wordmark
 *
 * The nextship wordmark from `brand/nextship.png`, drawn in half block characters:
 * a character cell is twice as tall as it is wide, so it holds two square pixels.
 * "Next" takes the terminal's own text colour, which is what the artwork's black
 * becomes on a dark background, so the wordmark reads on any theme without knowing
 * which one is in use. "Ship" and the dot of its i keep the brand blue and yellow.
 *
 * Author: Gowtham
 * Rules: ../../../AGENTS.md §4.3
 */

export type ColorDepth = 1 | 4 | 8 | 24

type Ink = '#' | 'b' | 'y'

/**
 * The wordmark, one character per pixel: `#` for "Next", `b` for the blue of "Ship",
 * `y` for the yellow dot. Sampled from the artwork at 26 artwork pixels to one, the
 * scale at which the cap height, the x-height and the baseline all fall on pixel
 * edges, then evened by hand so every stem is two pixels wide. No character cell
 * stacks two inks: a clear row separates the dot from its stem, which is what lets
 * each cell take a single colour.
 */
const WORDMARK = [
  '##......##.............................bbbbb....bb.......yy...........',
  '###.....##.....................##.....bbbbbbb...bb.......yy...........',
  '####....##.....................##....bbb...bbb..bb....................',
  '####....##....####...##....##.#####..bb.........bbbbbb...bb..bb.bbbb..',
  '#####...##...######...##..##..#####..bbb........bbbbbbb..bb..bbbbbbbb.',
  '##.###..##..##...###..######...##.....bbbbb.....bb...bb..bb..bbb...bbb',
  '##..###.##..##...###...####....##.......bbbbb...bb...bb..bb..bb.....bb',
  '##...#####..########....##.....##.........bbb...bb...bb..bb..bb.....bb',
  '##...#####..##.........####....##....bb....bbb..bb...bb..bb..bb.....bb',
  '##....####..##....#...######...###...bbb...bbb..bb...bb..bb..bbb...bbb',
  '##.....###..#######...##..##....###...bbbbbbb...bb...bb..bb..bbbbbbbb.',
  '##......##...#####...##....##...###....bbbbb....bb...bb..bb..bbbbbbb..',
  '.............................................................bb.......',
  '.............................................................bb.......',
  '.............................................................bb.......',
]

const COLUMNS = WORDMARK[0].length

/** Leading spaces, matching the indent of every other line the CLI prints. */
const INDENT = '  '

/**
 * The foreground each ink takes at each depth. "Next" is 39, the terminal's own
 * foreground, at every depth. Of the 16 colours, 94 is the blue closest to the brand's
 * in common themes, and 33 keeps the dot gold on a light background, where 93 fades.
 */
const INK: Record<Ink, Record<Exclude<ColorDepth, 1>, string>> = {
  '#': { 24: '39', 8: '39', 4: '39' },
  b: { 24: '38;2;0;94;255', 8: '38;5;27', 4: '94' },
  y: { 24: '38;2;253;207;24', 8: '38;5;220', 4: '33' },
}

/**
 * The colour depth to draw the wordmark in, or null where it should not be drawn:
 * into a pipe, where a script expects the usage, or a window too narrow to hold it,
 * which would wrap it. `NO_COLOR` gets depth 1, the wordmark without colour.
 */
export function logoDepth(terminal: {
  isTTY: boolean
  columns: number
  colorDepth: number
  noColor: boolean
}): ColorDepth | null {
  if (!terminal.isTTY || terminal.columns < INDENT.length + COLUMNS) return null
  if (terminal.noColor) return 1
  if (terminal.colorDepth >= 24) return 24
  if (terminal.colorDepth >= 8) return 8
  if (terminal.colorDepth >= 4) return 4
  return 1
}

/** The wordmark as terminal text, one line per pair of pixel rows. */
export function renderLogo(depth: ColorDepth): string {
  const lines: string[] = []
  for (let y = 0; y < WORDMARK.length; y += 2) {
    let line = INDENT
    let active = ''
    for (let x = 0; x < COLUMNS; x++) {
      const top = ink(x, y)
      const bottom = ink(x, y + 1)
      const pixel = top ?? bottom
      if (!pixel) {
        line += ' '
        continue
      }
      const color = depth === 1 ? '' : INK[pixel][depth]
      if (color !== active) {
        line += `\x1b[${color}m`
        active = color
      }
      line += top && bottom ? '█' : top ? '▀' : '▄'
    }
    // A colour left set would carry into the next line and into the prompt.
    lines.push(active ? `${line}\x1b[0m` : line)
  }
  return `${lines.join('\n')}\n`
}

function ink(x: number, y: number): Ink | null {
  const pixel = WORDMARK[y]?.[x]
  return pixel === '#' || pixel === 'b' || pixel === 'y' ? pixel : null
}
