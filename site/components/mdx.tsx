import Link from 'next/link'
import type { MDXComponents } from 'mdx/types'

/**
 * How MDX elements render.
 *
 * Styles live here rather than in a prose stylesheet so each element is styled
 * once, in one place, and an author writing plain Markdown gets the right
 * result without reaching for a class name.
 *
 * Author: Gowtham
 */
export const mdxComponents: MDXComponents = {
  h1: (props) => <h1 className="mt-12 scroll-mt-24 text-3xl font-semibold tracking-tight text-balance" {...props} />,
  h2: (props) => (
    <h2
      className="mt-14 scroll-mt-24 border-t border-border pt-8 text-xl font-semibold tracking-tight text-balance"
      {...props}
    />
  ),
  h3: (props) => <h3 className="mt-10 scroll-mt-24 text-base font-semibold tracking-tight" {...props} />,

  p: (props) => <p className="mt-5 leading-7 text-muted-strong text-pretty" {...props} />,

  a: ({ href = '', children, ...props }) => {
    const external = href.startsWith('http')
    const className = 'font-medium text-foreground underline decoration-border-strong underline-offset-4 transition-colors hover:decoration-foreground'

    return external ? (
      <a href={href} target="_blank" rel="noreferrer noopener" className={className} {...props}>
        {children}
      </a>
    ) : (
      <Link href={href} className={className} {...props}>
        {children}
      </Link>
    )
  },

  ul: (props) => <ul className="mt-5 ml-1 list-disc space-y-2 pl-5 marker:text-border-strong" {...props} />,
  ol: (props) => <ol className="mt-5 ml-1 list-decimal space-y-2 pl-5 marker:text-muted" {...props} />,
  li: (props) => <li className="leading-7 text-muted-strong" {...props} />,

  strong: (props) => <strong className="font-semibold text-foreground" {...props} />,

  blockquote: (props) => (
    <blockquote className="mt-6 border-l-2 border-border-strong pl-5 text-muted italic" {...props} />
  ),

  hr: () => <hr className="mt-12 border-border" />,

  // Wide tables scroll inside their own container, so the page body never
  // scrolls sideways on a phone.
  table: (props) => (
    <div className="mt-6 overflow-x-auto rounded-lg border border-border">
      <table className="w-full border-collapse text-sm" {...props} />
    </div>
  ),
  th: (props) => (
    <th className="border-b border-border bg-background-subtle px-4 py-2.5 text-left font-medium" {...props} />
  ),
  td: (props) => <td className="border-b border-border px-4 py-2.5 align-top text-muted-strong" {...props} />,

  // rehype-pretty-code wraps every block in a figure, so a bare `code` here is
  // always inline: the block case never reaches this component.
  code: (props) => (
    <code
      className="rounded border border-border bg-code-background px-1.5 py-0.5 font-mono text-[0.85em] text-foreground"
      {...props}
    />
  ),

  figure: (props) => (
    <figure className="mt-6 overflow-hidden rounded-lg border border-border bg-code-background" {...props} />
  ),
  pre: (props) => <pre className="overflow-x-auto" {...props} />,
}
