'use client'

import { Children, isValidElement, useRef } from 'react'

import { CopyButton } from '@/components/copy-button'

/**
 * A highlighted code block with a header saying what it is and a copy button.
 *
 * The copy reads the rendered text rather than a prop, because rehype-pretty-code
 * hands this figure an already highlighted tree with no source string attached.
 * Blocks tagged `bash` are commands to run and untagged blocks are what the CLI
 * prints, so the header tells the two apart.
 *
 * Author: Gowtham
 */
const LABELS: Record<string, string> = { bash: 'Terminal', sh: 'Terminal', text: 'Output' }

type Tagged = { 'data-language'?: string }

export function CodeBlock({ children, ...props }: React.ComponentProps<'figure'>) {
  const ref = useRef<HTMLElement>(null)
  const pre = Children.toArray(children).find(
    (child) => isValidElement<Tagged>(child) && child.props['data-language'] !== undefined
  )
  const language = (isValidElement<Tagged>(pre) && pre.props['data-language']) || 'text'

  return (
    <figure {...props} ref={ref} className="mt-6 overflow-hidden rounded-xl border border-border bg-code-background">
      <div className="flex items-center justify-between border-b border-border py-1.5 pr-1.5 pl-4">
        <span className="font-mono text-xs text-muted">{LABELS[language] ?? language}</span>
        <CopyButton label="Copy code" value={() => ref.current?.querySelector('code')?.innerText ?? ''} />
      </div>
      {children}
    </figure>
  )
}
