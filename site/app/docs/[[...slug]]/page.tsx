import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { MDXRemote } from 'next-mdx-remote/rsc'
import rehypeAutolinkHeadings from 'rehype-autolink-headings'
import rehypePrettyCode from 'rehype-pretty-code'
import rehypeSlug from 'rehype-slug'
import remarkGfm from 'remark-gfm'

import { mdxComponents } from '@/components/mdx'
import { getDoc, getHeadings } from '@/lib/docs'
import { DOCS_SLUGS, getNeighbours } from '@/lib/nav'

/**
 * Every documentation page.
 *
 * An optional catch-all, so /docs and /docs/introduction are the same page
 * rather than a redirect: the index of a docs site is its introduction, and a
 * redirect there costs a round trip for no benefit.
 *
 * Author: Gowtham
 */

// No slug reaches this route that generateStaticParams did not produce, so an
// unknown path is a 404 rather than an on-demand render.
export const dynamicParams = false

// Not `as const`: MDXRemote expects mutable Pluggable arrays, and a readonly
// tuple is not assignable to one.
const mdxOptions: NonNullable<React.ComponentProps<typeof MDXRemote>['options']>['mdxOptions'] = {
  remarkPlugins: [remarkGfm],
  rehypePlugins: [
    rehypeSlug,
    [rehypeAutolinkHeadings, { behavior: 'wrap', properties: { className: 'no-underline' } }],
    // Both themes are emitted and the stylesheet drops the unused one, so code
    // colours follow a theme switch without re-highlighting on the client.
    [rehypePrettyCode, { theme: { light: 'github-light', dark: 'github-dark-dimmed' }, keepBackground: false }],
  ],
}

export function generateStaticParams() {
  // The introduction is emitted twice on purpose: once as /docs, where the
  // empty slug array is the index, and once at its own address.
  return [{ slug: [] }, ...DOCS_SLUGS.map((slug) => ({ slug: [slug] }))]
}

function resolveSlug(slug: string[] | undefined): string | null {
  if (!slug || slug.length === 0) return 'introduction'
  if (slug.length > 1) return null

  const first = slug[0]
  return first && DOCS_SLUGS.includes(first) ? first : null
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug?: string[] }>
}): Promise<Metadata> {
  const slug = resolveSlug((await params).slug)
  if (!slug) return {}

  const doc = await getDoc(slug)
  return {
    title: doc.title,
    description: doc.description,
    openGraph: { title: doc.title, description: doc.description, type: 'article' },
  }
}

export default async function DocsPage({ params }: { params: Promise<{ slug?: string[] }> }) {
  const slug = resolveSlug((await params).slug)
  if (!slug) notFound()

  const doc = await getDoc(slug)
  const headings = getHeadings(doc.body)
  const { previous, next } = getNeighbours(slug)

  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_13rem] lg:gap-10">
      <article className="min-w-0 py-10 lg:py-14">
        <header>
          <p className="font-mono text-xs text-muted">Documentation</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight text-balance">{doc.title}</h1>
          <p className="mt-4 text-lg leading-relaxed text-muted text-pretty">{doc.description}</p>
        </header>

        <div className="mt-10">
          <MDXRemote source={doc.body} components={mdxComponents} options={{ mdxOptions }} />
        </div>

        <nav className="mt-16 grid gap-4 border-t border-border pt-8 sm:grid-cols-2" aria-label="Page navigation">
          {previous ? (
            <Link
              href={`/docs/${previous.slug}`}
              className="rounded-lg border border-border p-4 transition-colors hover:bg-card-hover"
            >
              <span className="text-xs text-muted">Previous</span>
              <span className="mt-1 block font-medium">{previous.title}</span>
            </Link>
          ) : (
            <span />
          )}

          {next ? (
            <Link
              href={`/docs/${next.slug}`}
              className="rounded-lg border border-border p-4 text-right transition-colors hover:bg-card-hover sm:col-start-2"
            >
              <span className="text-xs text-muted">Next</span>
              <span className="mt-1 block font-medium">{next.title}</span>
            </Link>
          ) : null}
        </nav>
      </article>

      {headings.length > 0 ? (
        <aside className="hidden lg:block">
          <div className="sticky top-16 max-h-[calc(100vh-4rem)] overflow-y-auto py-14">
            <h2 className="text-xs font-medium tracking-wide text-muted uppercase">On this page</h2>
            <ul className="mt-3 space-y-2 border-l border-border">
              {headings.map((heading) => (
                <li key={heading.id}>
                  <a
                    href={`#${heading.id}`}
                    className={`-ml-px block border-l border-transparent text-sm leading-snug text-muted transition-colors hover:border-border-strong hover:text-foreground ${
                      heading.level === 3 ? 'pl-7' : 'pl-4'
                    }`}
                  >
                    {heading.text}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      ) : null}
    </div>
  )
}
