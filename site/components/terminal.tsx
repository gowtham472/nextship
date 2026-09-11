import { BorderBeam } from '@/components/ui/border-beam'

/**
 * A terminal transcript that plays once: the command types itself out, then each
 * line of output appears in turn.
 *
 * The product is a CLI, so its own output is the most honest screenshot available.
 * Lines are data rather than markup, so the transcript stays readable in the source
 * and cannot drift into hand-written HTML that no longer matches what the tool
 * prints. Playback is CSS with a delay per line: it starts from the first paint with
 * no JavaScript, the text is in the page for search engines and screen readers from
 * the start, and under reduced motion the finished transcript is simply there. The
 * layout follows Magic UI's Terminal.
 *
 * Author: Gowtham
 */

export type Line =
  | { kind: 'command'; text: string }
  | { kind: 'output'; text: string }
  | { kind: 'muted'; text: string }
  | { kind: 'success'; text: string }
  | { kind: 'blank' }

const TONE: Record<Exclude<Line['kind'], 'blank' | 'command'>, string> = {
  output: 'text-muted-strong',
  muted: 'text-muted',
  success: 'font-medium text-accent-text',
}

/** When playback starts, how fast the command types, and how far apart output lines land. */
const START_MS = 1300
const TYPE_MS_PER_CHARACTER = 45
const LINE_GAP_MS = 260

export function Terminal({ title, lines }: { title: string; lines: Line[] }) {
  let clock = START_MS
  const timeline = lines.map((line) => {
    const delay = clock
    clock +=
      line.kind === 'command' ? line.text.length * TYPE_MS_PER_CHARACTER + 350 : line.kind === 'blank' ? 120 : LINE_GAP_MS
    return { line, delay }
  })

  return (
    <div className="relative overflow-hidden rounded-2xl border border-border bg-card/85 text-left shadow-[0_24px_80px_-32px_rgba(0,58,160,0.45)] backdrop-blur-xl">
      <BorderBeam size={160} duration={10} />
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <span className="flex gap-1.5" aria-hidden="true">
          <span className="h-2.5 w-2.5 rounded-full bg-border-strong" />
          <span className="h-2.5 w-2.5 rounded-full bg-border-strong" />
          <span className="h-2.5 w-2.5 rounded-full bg-border-strong" />
        </span>
        <span className="ml-1 font-mono text-xs text-muted">{title}</span>
      </div>

      <div className="overflow-x-auto p-5 sm:p-6">
        <pre className="font-mono text-[13px] leading-relaxed">
          <code>
            {timeline.map(({ line, delay }, index) => {
              if (line.kind === 'blank') return <span key={index} className="block h-3" />

              if (line.kind === 'command') {
                return (
                  <span key={index} className="block whitespace-pre text-foreground">
                    <span className="text-accent-text select-none">$ </span>
                    <span
                      className="term-type"
                      style={{ '--delay': `${delay}ms`, '--chars': line.text.length } as React.CSSProperties}
                    >
                      {line.text}
                    </span>
                  </span>
                )
              }

              return (
                <span
                  key={index}
                  className={`term-line block whitespace-pre ${TONE[line.kind]}`}
                  style={{ '--delay': `${delay}ms` } as React.CSSProperties}
                >
                  {line.text}
                  {index === timeline.length - 1 ? (
                    <span
                      className="term-caret ml-1 inline-block h-[1.1em] w-[0.55em] translate-y-[0.2em] bg-accent-text"
                      aria-hidden="true"
                    />
                  ) : null}
                </span>
              )
            })}
          </code>
        </pre>
      </div>
    </div>
  )
}
