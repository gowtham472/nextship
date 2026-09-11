/**
 * An endlessly scrolling row. The content is repeated so the loop never shows a
 * gap, and every copy after the first is hidden from assistive technology, which
 * would otherwise read the list once per copy.
 *
 * Adapted from Magic UI's Marquee, MIT License, Copyright (c) Magic UI; the licence
 * is in THIRD_PARTY_NOTICES.md.
 *
 * Author: Magic UI, adapted by Gowtham
 */
export function Marquee({ children, copies }: { children: React.ReactNode; copies: number }) {
  return (
    <div className="group flex gap-(--gap) overflow-hidden [--duration:45s] [--gap:0.75rem]">
      {Array.from({ length: copies }, (_, index) => (
        <div
          key={index}
          aria-hidden={index > 0 ? true : undefined}
          className="flex shrink-0 animate-marquee justify-around gap-(--gap) group-hover:[animation-play-state:paused]"
        >
          {children}
        </div>
      ))}
    </div>
  )
}
