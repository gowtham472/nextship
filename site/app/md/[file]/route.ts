import { getDoc } from '@/lib/docs'
import { toMarkdown } from '@/lib/markdown'
import { DOCS_SLUGS } from '@/lib/nav'

/**
 * Each docs page as markdown, at /md/<slug>.md, for agents that read text. Every docs
 * page names its markdown in a <link rel="alternate">, and llms.txt lists them all.
 *
 * Author: Gowtham
 */
// Required by output: 'export'. These are route handlers, so Next.js refuses to
// emit them as files until the route says it never depends on a request.
export const dynamic = 'force-static'
export const dynamicParams = false

export function generateStaticParams() {
  return DOCS_SLUGS.map((slug) => ({ file: `${slug}.md` }))
}

export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params
  const doc = await getDoc(file.replace(/\.md$/, ''))
  return new Response(toMarkdown(doc), { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } })
}
