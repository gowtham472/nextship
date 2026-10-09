/**
 * nextship-loadtest: typed error
 *
 * Every failure the user can cause carries a cause and a next action, so the CLI
 * never asks the user to interpret a stack trace. Its own class rather than the
 * CLI's, because this package is installed and run without nextship.
 *
 * Author: Gowtham
 * Rules: ../../../AGENTS.md §4.2
 */

export class LoadtestError extends Error {
  /** What the user should do next. Printed under the message by the entry point. */
  readonly action: string

  constructor(message: string, action: string) {
    super(message)
    this.name = 'LoadtestError'
    this.action = action
  }
}
