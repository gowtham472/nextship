import type { LanguageRegistration, ThemeRegistration } from 'shiki'

/**
 * Syntax colours for the documentation's code blocks, and a grammar for what the
 * CLI prints.
 *
 * The palette follows the brand: blue for what you run, green for strings, pink for
 * keywords, the brand yellow for constants. The light theme darkens each hue until
 * it clears contrast on the pale code background rather than reusing the dark
 * values.
 *
 * Author: Gowtham
 */

interface Palette {
  foreground: string
  comment: string
  keyword: string
  callable: string
  string: string
  type: string
  constant: string
  step: string
  ok: string
  warn: string
  fail: string
  detail: string
}

const DARK: Palette = {
  foreground: '#e6ebf5',
  comment: '#7d8aa6',
  keyword: '#ff6b9d',
  callable: '#6aa9ff',
  string: '#6fd08c',
  type: '#c58bff',
  constant: '#fdcf18',
  step: '#6aa9ff',
  ok: '#6fd08c',
  warn: '#fdcf18',
  fail: '#ff6b6b',
  detail: '#8b97b0',
}

const LIGHT: Palette = {
  foreground: '#0b1530',
  comment: '#6b7690',
  keyword: '#c2185b',
  callable: '#0050d6',
  string: '#1a7f37',
  type: '#7c3aed',
  constant: '#8a5a00',
  step: '#0050d6',
  ok: '#1a7f37',
  warn: '#8a5a00',
  fail: '#cf222e',
  detail: '#5b6680',
}

function theme(name: string, type: 'light' | 'dark', p: Palette): ThemeRegistration {
  const rule = (scope: string[], foreground: string) => ({ scope, settings: { foreground } })
  return {
    name,
    type,
    colors: { 'editor.foreground': p.foreground },
    tokenColors: [
      rule(['comment', 'punctuation.definition.comment'], p.comment),
      // A shell grammar scopes every argument as a string, which would paint whole
      // commands green. Arguments stay the text colour, so the command stands out.
      rule(['string.unquoted.argument'], p.foreground),
      rule(['keyword', 'storage', 'keyword.operator'], p.keyword),
      rule(['string', 'punctuation.definition.string'], p.string),
      rule(
        [
          'entity.name.function',
          'support.function',
          'entity.name.command',
          'variable.other.constant',
          'support.variable',
          'support.class',
          'support.type.property-name',
        ],
        p.callable
      ),
      rule(['entity.name.type', 'support.type', 'variable.other.normal', 'punctuation.definition.variable'], p.type),
      rule(['constant.numeric', 'constant.language'], p.constant),
      rule(['markup.output.step'], p.step),
      rule(['markup.output.ok'], p.ok),
      rule(['markup.output.warn'], p.warn),
      rule(['markup.output.fail'], p.fail),
      rule(['markup.output.detail'], p.detail),
    ],
  }
}

export const darkTheme = theme('nextship-dark', 'dark', DARK)
export const lightTheme = theme('nextship-light', 'light', LIGHT)

/**
 * What the CLI prints, coloured the way the terminal colours it: the marker that
 * opens a step, a result, a warning or a failure takes that line's colour, and an
 * indented detail line is dimmed. Mirrors `packages/cli/src/util/log.ts`, so a
 * change to how the CLI paints a line belongs in both places.
 */
export const outputLanguage: LanguageRegistration = {
  name: 'output',
  scopeName: 'text.nextship.output',
  repository: {},
  patterns: [
    { match: '^(>)(?= |$)', captures: { 1: { name: 'markup.output.step' } } },
    { match: '^(v)(?= |$)', captures: { 1: { name: 'markup.output.ok' } } },
    { match: '^(!)(?= |$)', captures: { 1: { name: 'markup.output.warn' } } },
    { match: '^(x)(?= |$)', captures: { 1: { name: 'markup.output.fail' } } },
    { match: '^  .*$', name: 'markup.output.detail' },
  ],
}
