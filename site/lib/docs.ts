import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

import matter from 'gray-matter'

import { DOCS_SLUGS } from './nav'

/**
 * Loading and validating the MDX under content/docs.
 *
 * Every read happens at build time, so a malformed page fails the build rather
 * than rendering an empty article in production. The checks are deliberately
 * loud for the same reason: a docs site that silently drops a page is worse
 * than one that refuses to build.
 *
 * Author: Gowtham
 */

const CONTENT_DIR = path.join(process.cwd(), 'content', 'docs')

export interface DocFrontmatter {
  title: string
  description: string
}

export interface Doc extends DocFrontmatter {
  slug: string
  body: string
}

export interface Heading {
  id: string
  text: string
  level: 2 | 3
}

function assertFrontmatter(slug: string, data: Record<string, unknown>): DocFrontmatter {
  const { title, description } = data

  if (typeof title !== 'string' || title.trim() === '') {
    throw new Error(`content/docs/${slug}.mdx is missing a "title" in its frontmatter.`)
  }
  if (typeof description !== 'string' || description.trim() === '') {
    // The description is the page's meta description and the card subtitle on
    // the docs index, so an empty one degrades search results silently.
    throw new Error(`content/docs/${slug}.mdx is missing a "description" in its frontmatter.`)
  }

  return { title, description }
}

export async function getDoc(slug: string): Promise<Doc> {
  const file = path.join(CONTENT_DIR, `${slug}.mdx`)
  const source = await readFile(file, 'utf8')
  const { content, data } = matter(source)

  return { slug, body: content, ...assertFrontmatter(slug, data) }
}

/**
 * Every page, in the reading order the navigation declares.
 *
 * Reconciles the outline in nav.ts against the files on disk in both
 * directions, because the two failure modes are equally bad and equally quiet:
 * a page nothing links to is invisible, and a link to a page that does not
 * exist is a 404 that only a visitor discovers.
 */
export async function getAllDocs(): Promise<Doc[]> {
  const entries = await readdir(CONTENT_DIR)
  const onDisk = entries.filter((name) => name.endsWith('.mdx')).map((name) => name.replace(/\.mdx$/, ''))

  const missing = DOCS_SLUGS.filter((slug) => !onDisk.includes(slug))
  if (missing.length > 0) {
    throw new Error(
      `The docs navigation lists pages that do not exist: ${missing.join(', ')}. ` +
        'Add the MDX file, or remove the entry from lib/nav.ts.'
    )
  }

  const unlisted = onDisk.filter((slug) => !DOCS_SLUGS.includes(slug))
  if (unlisted.length > 0) {
    throw new Error(
      `These pages exist but nothing links to them: ${unlisted.join(', ')}. ` +
        'Add them to DOCS_NAV in lib/nav.ts, or delete them.'
    )
  }

  return Promise.all(DOCS_SLUGS.map(getDoc))
}

/**
 * Headings for the in-page table of contents.
 *
 * Parsed from the raw MDX rather than from the rendered output, because the
 * rendered output is a React tree by the time it exists and walking it to find
 * headings would mean rendering the page twice.
 *
 * Fenced code blocks are stripped first: a shell comment such as `# install`
 * is not a heading, and treating it as one puts nonsense in the sidebar.
 */
export function getHeadings(body: string): Heading[] {
  const withoutCode = body.replace(/```[\s\S]*?```/g, '')
  const headings: Heading[] = []

  for (const line of withoutCode.split('\n')) {
    const match = /^(#{2,3})\s+(.+?)\s*$/.exec(line)
    if (!match) continue

    const hashes = match[1]
    const text = match[2]
    if (!hashes || !text) continue

    headings.push({
      id: slugify(text),
      text: stripInlineMarkdown(text),
      level: hashes.length === 2 ? 2 : 3,
    })
  }

  return headings
}

/** Matches rehype-slug, so anchors and the table of contents agree. */
export function slugify(text: string): string {
  return stripInlineMarkdown(text)
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
}

function stripInlineMarkdown(text: string): string {
  return text
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
}
