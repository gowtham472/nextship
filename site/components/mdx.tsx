import Link from 'next/link'
import type { MDXComponents } from 'mdx/types'

import { Callout } from '@/components/docs/callout'
import { CodeBlock } from '@/components/docs/code-block'

/**
 * How MDX elements render.
 *
 * Styles live here rather than in a prose stylesheet so each element is styled
 * once, in one place, and an author writing plain Markdown gets the right result
 * without reaching for a class name.
 *
 * Author: Gowtham
 */
export const mdxComponents: MDXComponents = {
  // `group` lets the appended anchor appear when the heading is hovered.
  h2: (props) => <h2 className="group mt-14 scroll-mt-28 text-2xl font-bold tracking-tight text-balance" {...props} />,
  h3: (props) => <h3 className="group mt-10 scroll-mt-28 text-lg font-semibold tracking-tight" {...props} />,

  p: (props) => <p className="mt-5 leading-7 text-muted-strong text-pretty" {...props} />,

  a: ({ href = '', className, children, ...props }) => {
    // rehype-autolink-headings appends one of these to every heading: a quiet hash
    // that appears on hover, not a link dressed as prose.
    if (className?.includes('heading-anchor')) {
      return (
        <a
          href={href}
          className="ml-2 font-normal text-muted no-underline opacity-0 transition-opacity group-hover:opacity-100 hover:text-accent-text focus-visible:opacity-100"
          {...props}
        >
          {children}
        </a>
      )
    }

    const external = href.startsWith('http')
    const style =
      'font-medium text-accent-text underline decoration-accent-text/30 underline-offset-4 transition-colors hover:decoration-accent-text'

    return external ? (
      <a href={href} target="_blank" rel="noreferrer noopener" className={style} {...props}>
        {children}
      </a>
    ) : (
      <Link href={href} className={style} {...props}>
        {children}
      </Link>
    )
  },

  ul: (props) => <ul className="mt-5 ml-1 list-disc space-y-2 pl-5 marker:text-accent-text/60" {...props} />,
  ol: (props) => <ol className="mt-5 ml-1 list-decimal space-y-2 pl-5 marker:font-semibold marker:text-accent-text" {...props} />,
  li: (props) => <li className="pl-1 leading-7 text-muted-strong" {...props} />,

  strong: (props) => <strong className="font-semibold text-foreground" {...props} />,

  blockquote: (props) => (
    <blockquote className="mt-6 rounded-r-lg border-l-2 border-accent bg-accent/5 py-1 pr-4 pl-5 text-muted-strong" {...props} />
  ),

  hr: () => <hr className="mt-12 border-border" />,

  // Wide tables scroll inside their own container, so the page body never
  // scrolls sideways on a phone.
  table: (props) => (
    <div className="mt-6 overflow-x-auto rounded-xl border border-border">
      <table className="w-full border-collapse text-sm" {...props} />
    </div>
  ),
  thead: (props) => <thead className="bg-background-subtle" {...props} />,
  tr: (props) => <tr className="transition-colors hover:bg-background-subtle/60" {...props} />,
  th: (props) => (
    <th className="border-b border-border px-4 py-3 text-left text-xs font-semibold tracking-wide uppercase" {...props} />
  ),
  td: (props) => (
    <td className="border-b border-border px-4 py-3 align-top text-muted-strong [tr:last-child_&]:border-b-0" {...props} />
  ),

  // rehype-pretty-code marks every block's code with the language it highlighted
  // as, untagged fences included, so the attribute tells a block from inline code.
  code: (props) =>
    'data-language' in props ? (
      <code {...props} />
    ) : (
      <code
        className="rounded-md border border-border bg-code-background px-1.5 py-0.5 font-mono text-[0.85em] text-foreground"
        {...props}
      />
    ),

  figure: (props) => ('data-rehype-pretty-code-figure' in props ? <CodeBlock {...props} /> : <figure {...props} />),
  pre: (props) => <pre className="overflow-x-auto" {...props} />,

  Callout,
}
