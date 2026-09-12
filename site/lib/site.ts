/**
 * Where this site is served from.
 *
 * Open Graph and Twitter images have to be absolute URLs, so Next.js needs a
 * base it cannot infer at build time. It is a constant rather than an
 * environment variable because a build that forgets the variable ships cards
 * pointing at localhost, and a build given the wrong value has already shipped
 * cards that 404 once. Changing where the site is served is a change to this
 * line, reviewed like any other.
 *
 * Author: Gowtham
 */
export const SITE_URL = 'https://nextship.saap.workers.dev'
