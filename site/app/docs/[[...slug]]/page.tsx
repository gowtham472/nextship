import type { Metadata, ResolvingMetadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, ArrowRight, ChevronRight, SquarePen } from 'lucide-react'
import { MDXRemote } from 'next-mdx-remote/rsc'
import rehypeAutolinkHeadings from 'rehype-autolink-headings'
import rehypePrettyCode from 'rehype-pretty-code'
import rehypeSlug from 'rehype-slug'
import remarkGfm from 'remark-gfm'

import { TableOfContents } from '@/components/docs/toc'
import { mdxComponents } from '@/components/mdx'
import { getDoc, getHeadings } from '@/lib/docs'
import { DOCS_SLUGS, getNeighbours, getSection } from '@/lib/nav'

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

const EDIT_BASE = 'https://github.com/gowtham472/nextship/blob/main/site/content/docs'

// Not `as const`: MDXRemote expects mutable Pluggable arrays, and a readonly
// tuple is not assignable to one.
const mdxOptions: NonNullable<React.ComponentProps<typeof MDXRemote>['options']>['mdxOptions'] = {
  remarkPlugins: [remarkGfm],
  rehypePlugins: [
    rehypeSlug,
    [
      rehypeAutolinkHeadings,
      {
        behavior: 'append',
        properties: { className: ['heading-anchor'], ariaLabel: 'Link to this section' },
        content: { type: 'text', value: '#' },
      },
    ],
    // Both themes are emitted and the stylesheet drops the unused one, so code
    // colours follow a theme switch without re-highlighting on the client. Untagged
    // fences, which hold what the CLI prints, are treated as plain text so they get
    // the same block as everything else rather than falling through unstyled.
    [
      rehypePrettyCode,
      {
        theme: { light: 'github-light', dark: 'github-dark-dimmed' },
        keepBackground: false,
        defaultLang: { block: 'text' },
      },
    ],
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

export async function generateMetadata(
  { params }: { params: Promise<{ slug?: string[] }> },
  parent: ResolvingMetadata
): Promise<Metadata> {
  const slug = resolveSlug((await params).slug)
  if (!slug) return {}

  const doc = await getDoc(slug)
  // A page's own openGraph replaces the inherited one whole, image included, so the
  // site's share image is carried over or a docs link previews without one.
  const images = (await parent).openGraph?.images ?? []
  return {
    title: doc.title,
    description: doc.description,
    openGraph: { title: doc.title, description: doc.description, type: 'article', images },
  }
}

export default async function DocsPage({ params }: { params: Promise<{ slug?: string[] }> }) {
  const slug = resolveSlug((await params).slug)
  if (!slug) notFound()

  const doc = await getDoc(slug)
  const headings = getHeadings(doc.body)
  const { previous, next } = getNeighbours(slug)
  const editUrl = `${EDIT_BASE}/${slug}.mdx`

  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_14rem] lg:gap-12">
      <article className="min-w-0 pt-8 pb-16 lg:pt-12">
        <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm text-muted">
          <Link href="/docs" className="transition-colors hover:text-foreground">
            Docs
          </Link>
          <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="font-medium text-accent-text">{getSection(slug)}</span>
        </nav>

        <h1 className="mt-4 text-4xl font-extrabold tracking-[-0.03em] text-balance sm:text-5xl">{doc.title}</h1>
        <p className="mt-4 text-lg leading-relaxed text-muted text-pretty">{doc.description}</p>

        <div className="mt-10 border-t border-border">
          <MDXRemote source={doc.body} components={mdxComponents} options={{ mdxOptions }} />
        </div>

        <footer className="mt-16 border-t border-border pt-8">
          {/* The outline column carries this link from lg up. */}
          <a
            href={editUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="mb-8 inline-flex items-center gap-2 text-sm text-muted transition-colors hover:text-foreground lg:hidden"
          >
            <SquarePen className="h-4 w-4" aria-hidden="true" />
            Edit this page on GitHub
          </a>

          <nav className="grid gap-4 sm:grid-cols-2" aria-label="Page navigation">
            {previous ? (
              <Link
                href={`/docs/${previous.slug}`}
                className="group rounded-xl border border-border p-5 transition-colors hover:border-accent/50 hover:bg-card-hover"
              >
                <span className="flex items-center gap-1.5 text-xs text-muted">
                  <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                  Previous
                </span>
                <span className="mt-1.5 block font-semibold transition-colors group-hover:text-accent-text">
                  {previous.title}
                </span>
              </Link>
            ) : (
              <span />
            )}

            {next ? (
              <Link
                href={`/docs/${next.slug}`}
                className="group rounded-xl border border-border p-5 text-right transition-colors hover:border-accent/50 hover:bg-card-hover sm:col-start-2"
              >
                <span className="flex items-center justify-end gap-1.5 text-xs text-muted">
                  Next
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </span>
                <span className="mt-1.5 block font-semibold transition-colors group-hover:text-accent-text">
                  {next.title}
                </span>
              </Link>
            ) : null}
          </nav>
        </footer>
      </article>

      <aside className="hidden lg:block">
        <div className="sticky top-16 max-h-[calc(100vh-4rem)] overflow-y-auto py-12">
          <TableOfContents headings={headings} editUrl={editUrl} />
        </div>
      </aside>
    </div>
  )
}
