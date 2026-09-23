import { getAllDocs } from '@/lib/docs'
import { toMarkdown } from '@/lib/markdown'

/**
 * Every docs page as markdown in one file, in reading order, for an agent that wants
 * the whole documentation in a single request. llms.txt links here.
 *
 * Author: Gowtham
 */
// Required by output: 'export'. These are route handlers, so Next.js refuses to
// emit them as files until the route says it never depends on a request.
export const dynamic = 'force-static'

export async function GET() {
  const docs = await getAllDocs()
  const text = docs.map(toMarkdown).join('\n---\n\n')
  return new Response(text, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
}
