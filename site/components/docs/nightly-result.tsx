'use client'

import { useEffect, useState } from 'react'

import { NIGHTLY_RESULT_URL, NIGHTLY_RUNS_URL, type NightlyResult as Result } from '@/lib/evidence'

/**
 * Last night's compatibility suite result, read from the `evidence` branch when the
 * page opens.
 *
 * When the file cannot be read, the page says so and links to the runs instead of
 * showing a number: before the first published night there is no file, and a figure
 * rendered from nothing would be exactly the fabricated claim the evidence page exists
 * to avoid.
 *
 * Author: Ragul D
 */
export function NightlyResult() {
  const [state, setState] = useState<{ result: Result } | 'loading' | 'unavailable'>('loading')

  useEffect(() => {
    const controller = new AbortController()
    const load = async () => {
      try {
        const response = await fetch(NIGHTLY_RESULT_URL, { signal: controller.signal, cache: 'no-store' })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        setState({ result: (await response.json()) as Result })
      } catch {
        // Unmounting aborts the fetch; nothing is left to update then.
        if (!controller.signal.aborted) setState('unavailable')
      }
    }
    void load()
    return () => controller.abort()
  }, [])

  const link = 'font-medium text-accent-text underline decoration-accent-text/30 underline-offset-4 hover:decoration-accent-text'

  if (state === 'loading') {
    return <p className="mt-5 leading-7 text-muted">Reading last night&apos;s result…</p>
  }
  if (state === 'unavailable') {
    return (
      <p className="mt-5 leading-7 text-muted-strong">
        Last night&apos;s result could not be read here. Every run is listed on{' '}
        <a href={NIGHTLY_RUNS_URL} target="_blank" rel="noreferrer noopener" className={link}>
          GitHub Actions
        </a>
        .
      </p>
    )
  }

  const { result } = state
  const rows = [
    ['Run', new Date(result.date).toUTCString().replace(' GMT', ' UTC')],
    ['Next.js', `${result.nextjs.version} (${result.nextjs.sha.slice(0, 9)})`],
    ['Suites passing', `${result.suites.passed} of ${result.suites.total}`],
    ['Assertions passing', `${result.assertions.passed} of ${result.assertions.total}`],
    ['Failing suites', result.failing.length === 0 ? 'None' : result.failing.join(', ')],
  ]
  return (
    <div className="mt-6 overflow-x-auto rounded-xl border border-border">
      <table className="w-full border-collapse text-sm">
        <tbody>
          {rows.map(([label, value]) => (
            <tr key={label}>
              <th scope="row" className="border-b border-border px-4 py-3 text-left font-semibold whitespace-nowrap">
                {label}
              </th>
              <td className="border-b border-border px-4 py-3 align-top text-muted-strong">{value}</td>
            </tr>
          ))}
          <tr>
            <td colSpan={2} className="px-4 py-3">
              <a href={result.run} target="_blank" rel="noreferrer noopener" className={link}>
                The full run on GitHub Actions
              </a>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}
