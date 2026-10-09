/**
 * nextship-loadtest: terminal output
 *
 * The same visual format as every nextship command, so a load test reads like the
 * deploy before it. Repeated here rather than imported, because this package is
 * installed and run without nextship.
 *
 * Author: Gowtham
 * Rules: ../../../AGENTS.md §4.3
 */

const color = process.stdout.isTTY && !process.env.NO_COLOR

const paint = (code: string, text: string) => (color ? `\u001b[${code}m${text}\u001b[0m` : text)

/** Announces a stage that is starting. */
export function step(message: string): void {
  process.stdout.write(`${paint('34', '>')} ${message}\n`)
}

/** Reports a completed stage by its result, never by the effort it took. */
export function ok(message: string): void {
  process.stdout.write(`${paint('32', 'v')} ${message}\n`)
}

/** Supporting detail under a step or result. */
export function detail(message: string): void {
  process.stdout.write(`  ${paint('90', message)}\n`)
}

/** A cause and the action that resolves it. */
export function fail(message: string, action: string): void {
  process.stderr.write(`${paint('31', 'x')} ${message}\n`)
  process.stderr.write(`  ${action}\n`)
}
