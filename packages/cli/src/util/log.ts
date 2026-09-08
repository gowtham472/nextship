/**
 * @nextship/cli: terminal output
 *
 * One visual format for every command, so progress reads the same way whichever
 * stage the user is running.
 *
 * Author: Gowtham
 * Rules: ../../../../AGENTS.md §4.3
 */

const color = process.stdout.isTTY && !process.env.NO_COLOR

const paint = (code: string, text: string) => (color ? `[${code}m${text}[0m` : text)

/** Announces a pipeline stage that is starting. */
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

/** Something the user must know about that does not stop the run. */
export function warn(message: string): void {
  process.stderr.write(`${paint('33', '!')} ${message}\n`)
}

/** A cause and the action that resolves it. */
export function fail(message: string, action: string): void {
  process.stderr.write(`${paint('31', 'x')} ${message}\n`)
  process.stderr.write(`  ${action}\n`)
}
