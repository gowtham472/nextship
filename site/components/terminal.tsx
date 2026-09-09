/**
 * A terminal transcript.
 *
 * The product is a CLI, so its own output is the most honest screenshot
 * available. Lines are data rather than markup so the transcript stays
 * copy-pasteable and readable in the source, and so it cannot drift into
 * hand-written HTML that no longer matches what the tool prints.
 *
 * Author: Gowtham
 */

export type Line =
  | { kind: 'command'; text: string }
  | { kind: 'output'; text: string }
  | { kind: 'muted'; text: string }
  | { kind: 'success'; text: string }
  | { kind: 'blank' }

const TONE: Record<Exclude<Line['kind'], 'blank'>, string> = {
  command: 'text-foreground',
  output: 'text-muted-strong',
  muted: 'text-muted',
  success: 'text-emerald-500 dark:text-emerald-400',
}

export function Terminal({ title, lines }: { title: string; lines: Line[] }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <span className="flex gap-1.5" aria-hidden="true">
          <span className="h-2.5 w-2.5 rounded-full bg-border-strong" />
          <span className="h-2.5 w-2.5 rounded-full bg-border-strong" />
          <span className="h-2.5 w-2.5 rounded-full bg-border-strong" />
        </span>
        <span className="ml-1 font-mono text-xs text-muted">{title}</span>
      </div>

      <div className="overflow-x-auto p-4 sm:p-5">
        <pre className="font-mono text-[13px] leading-relaxed">
          <code>
            {lines.map((line, index) =>
              line.kind === 'blank' ? (
                <span key={index} className="block h-3" />
              ) : (
                <span key={index} className={`block whitespace-pre ${TONE[line.kind]}`}>
                  {line.kind === 'command' ? (
                    <>
                      <span className="select-none text-muted">$ </span>
                      {line.text}
                    </>
                  ) : (
                    line.text
                  )}
                </span>
              )
            )}
          </code>
        </pre>
      </div>
    </div>
  )
}
