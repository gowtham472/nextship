/**
 * @nextship/cli: typed error
 *
 * Every failure the user can cause carries a cause and a next action, so the CLI
 * never asks the user to interpret a stack trace.
 *
 * Author: Gowtham
 * Rules: ../../../AGENTS.md §4.2
 */

export class NextshipError extends Error {
  /** What the user should do next. Printed under the message by the CLI entry point. */
  readonly action: string

  constructor(message: string, action: string) {
    super(message)
    this.name = 'NextshipError'
    this.action = action
  }
}
