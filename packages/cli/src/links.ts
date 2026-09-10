/**
 * @nextship/cli: links into the published documentation
 *
 * Anything an installed CLI prints has to resolve on the machine it is printed
 * on. Someone who ran `npm install -g nextship-cli` has no docs directory, so a
 * relative `docs/` path in a message sends them to a file that does not exist.
 * Every reference a user can see is built here, as an absolute URL.
 *
 * Author: Gowtham
 */

const REPOSITORY = 'https://github.com/gowtham472/nextship'

/** A document under docs/ in the repository, optionally at a heading anchor. */
export function docsUrl(file: string, anchor?: string): string {
  return `${REPOSITORY}/blob/main/docs/${file}${anchor ? `#${anchor}` : ''}`
}
