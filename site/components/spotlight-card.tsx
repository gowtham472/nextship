'use client'

/**
 * A card lit by a soft light that follows the pointer.
 *
 * The position is written to two CSS custom properties instead of React state, so
 * moving the pointer never re-renders the card; globals.css draws the light from
 * them. Touch has no hover, so on a phone the card is simply a card.
 *
 * Author: Gowtham
 */
export function SpotlightCard({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <div
      className={`spotlight ${className}`}
      onPointerMove={(event) => {
        const card = event.currentTarget
        const box = card.getBoundingClientRect()
        card.style.setProperty('--spot-x', `${event.clientX - box.left}px`)
        card.style.setProperty('--spot-y', `${event.clientY - box.top}px`)
      }}
    >
      {children}
    </div>
  )
}
