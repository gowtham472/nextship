import { Info, TriangleAlert } from 'lucide-react'

/**
 * A passage the reader should not skim past: `note` for something to know,
 * `warning` for something that costs you if it is missed. The kind is announced
 * to screen readers, since the colour and the icon carry it for everyone else.
 *
 * Author: Gowtham
 */
const TONES = {
  note: { label: 'Note', Icon: Info, box: 'border-accent/25 bg-accent/5', icon: 'text-accent-text' },
  warning: { label: 'Warning', Icon: TriangleAlert, box: 'border-highlight/60 bg-highlight/10', icon: 'text-highlight-text' },
} as const

export function Callout({ type, children }: { type: keyof typeof TONES; children: React.ReactNode }) {
  const tone = TONES[type]
  return (
    <aside className={`mt-6 flex gap-3 rounded-xl border px-4 py-3.5 ${tone.box}`}>
      <tone.Icon className={`mt-1 h-4 w-4 shrink-0 ${tone.icon}`} aria-hidden="true" />
      <div className="min-w-0 text-[15px] [&>p]:mt-0 [&>p+p]:mt-3">
        <span className="sr-only">{tone.label}: </span>
        {children}
      </div>
    </aside>
  )
}
