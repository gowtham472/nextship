import type { Doc } from './docs'
import { SITE_URL } from './site'

/**
 * The docs as plain markdown, for AI agents and anything else that reads text rather
 * than a rendered page.
 *
 * The MDX is already markdown apart from one component, so conversion is small and
 * strict: a callout becomes a blockquote, and links become absolute, pointing a docs
 * link at that page's markdown so an agent can keep reading in the same format. Any
 * other component fails the build, because an agent handed raw JSX would read it as
 * content, and a page that quietly lost a component is worse than one that refuses to
 * build.
 *
 * Author: Gowtham
 */

/** Where a page's markdown is served. Docs pages link to it in their head. */
export function markdownPath(slug: string): string {
  return `/md/${slug}.md`
}

export function toMarkdown(doc: Doc): string {
  const body = doc.body
    .replace(/<Callout type="(\w+)">\s*([\s\S]*?)\s*<\/Callout>/g, (_, type: string, content: string) => {
      const label = `**${type.charAt(0).toUpperCase()}${type.slice(1)}:** `
      return (label + content.trim())
        .split('\n')
        .map((line) => (line ? `> ${line}` : '>'))
        .join('\n')
    })
    .replace(/\]\((\/[^)\s]*)\)/g, (_, target: string) => `](${absolute(target)})`)

  const leftover = /<[A-Z][A-Za-z]*/.exec(body.replace(/```[\s\S]*?```/g, ''))
  if (leftover) {
    throw new Error(
      `content/docs/${doc.slug}.mdx uses ${leftover[0]}>, which lib/markdown.ts cannot turn into markdown. ` +
        'Teach toMarkdown to convert it, or write it as plain markdown.'
    )
  }

  return `# ${doc.title}\n\n> ${doc.description}\n\nSource: ${SITE_URL}${doc.slug === 'introduction' ? '/docs' : `/docs/${doc.slug}`}\n\n${body.trim()}\n`
}

/** A site-relative link made absolute, with docs pages pointed at their markdown. */
function absolute(target: string): string {
  const docs = /^\/docs(?:\/([a-z0-9-]+))?(#.*)?$/.exec(target)
  if (docs) return `${SITE_URL}${markdownPath(docs[1] ?? 'introduction')}${docs[2] ?? ''}`
  return `${SITE_URL}${target}`
}
