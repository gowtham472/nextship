/**
 * Where the nightly compatibility suite publishes its result.
 *
 * `conformance/publish-evidence.mjs`, run by the scheduled workflow, writes
 * `latest.json` to the repository's `evidence` branch. The page reads it in the
 * browser rather than at build time, so the evidence page shows last night's run
 * without the site being rebuilt every night.
 *
 * Author: Ragul D
 */
export const NIGHTLY_RESULT_URL = 'https://raw.githubusercontent.com/gowtham472/nextship/evidence/latest.json'

/** Where every run, published or not, can be read in full. */
export const NIGHTLY_RUNS_URL = 'https://github.com/gowtham472/nextship/actions/workflows/conformance.yml'

/** What `publish-evidence.mjs` writes, as far as the page reads it. */
export interface NightlyResult {
  date: string
  nextjs: { version: string; sha: string }
  run: string
  suites: { passed: number; total: number }
  assertions: { passed: number; total: number }
  failing: string[]
}
