'use client'

import { Children, isValidElement, useRef } from 'react'
import { Braces, FileCode, ScrollText, SquareTerminal, type LucideIcon } from 'lucide-react'

import { CopyButton } from '@/components/copy-button'

/**
 * A highlighted code block: a header naming what the block is, then the code.
 *
 * The header shows a fence's `title` when it has one, which is how a block holding a
 * file names that file, and otherwise says what kind of block it is. Blocks tagged
 * `bash` are commands to run and untagged blocks are what the CLI prints, so those
 * two read as Terminal and Output.
 *
 * rehype-pretty-code renders a title as a figcaption inside the figure. It is lifted
 * into the header here rather than left above the code, so a titled block and an
 * untitled one share one layout.
 *
 * The copy reads the rendered text rather than a prop, because rehype-pretty-code
 * hands this figure an already highlighted tree with no source string attached.
 *
 * Author: Gowtham
 */
const LABELS: Record<string, string> = {
  bash: 'Terminal',
  sh: 'Terminal',
  output: 'Output',
  json: 'JSON',
  jsonc: 'JSON',
  ts: 'TypeScript',
  tsx: 'TypeScript',
  js: 'JavaScript',
  jsx: 'JavaScript',
}

const ICONS: Record<string, LucideIcon> = {
  bash: SquareTerminal,
  sh: SquareTerminal,
  output: ScrollText,
  json: Braces,
  jsonc: Braces,
}

// Script files get a lettered badge, the way editors mark them, because a generic
// file icon does not say which of the two it is.
const BADGES: Record<string, string> = { ts: 'TS', tsx: 'TS', js: 'JS', jsx: 'JS' }

type Tagged = { 'data-language'?: string; 'data-rehype-pretty-code-title'?: string; children?: React.ReactNode }

function LanguageMark({ language }: { language: string }) {
  const badge = BADGES[language]
  if (badge) {
    return (
      <span
        aria-hidden="true"
        className="grid h-4 w-4 place-items-center rounded-[3px] bg-muted font-mono text-[7.5px] leading-none font-bold text-code-background"
      >
        {badge}
      </span>
    )
  }
  const Icon = ICONS[language] ?? FileCode
  return <Icon className="h-4 w-4" aria-hidden="true" />
}

export function CodeBlock({ children, ...props }: React.ComponentProps<'figure'>) {
  const ref = useRef<HTMLElement>(null)
  const parts = Children.toArray(children)

  const isTitle = (child: React.ReactNode) =>
    isValidElement<Tagged>(child) && child.props['data-rehype-pretty-code-title'] !== undefined
  const title = parts.find(isTitle)
  const pre = parts.find(
    (child) => !isTitle(child) && isValidElement<Tagged>(child) && child.props['data-language'] !== undefined
  )

  const language = (isValidElement<Tagged>(pre) && pre.props['data-language']) || 'output'
  const heading = isValidElement<Tagged>(title) ? title.props.children : (LABELS[language] ?? language)

  return (
    <figure {...props} ref={ref} className="mt-6 overflow-hidden rounded-xl border border-border bg-code-background">
      <div className="flex items-center justify-between gap-3 border-b border-border py-1.5 pr-1.5 pl-4">
        <span className="flex min-w-0 items-center gap-2 text-muted">
          <LanguageMark language={language} />
          <span className="truncate text-[0.8125rem] font-medium text-muted-strong">{heading}</span>
        </span>
        <CopyButton label="Copy code" iconOnly value={() => ref.current?.querySelector('code')?.innerText ?? ''} />
      </div>
      {parts.filter((child) => !isTitle(child))}
    </figure>
  )
}
