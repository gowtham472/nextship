import { BorderBeam } from '@/components/ui/border-beam'

/**
 * A recording of one real deployment, shown where a hand-written transcript used to
 * be.
 *
 * The recording is the evidence rather than an illustration: `public/media/deploy.cast`
 * holds every byte the terminal printed with its real timing, and the animation is
 * rendered from it with only the pauses longer than two seconds shortened. A reader
 * who asks their system for reduced motion gets the final frame instead, which is
 * where the result is.
 *
 * Author: Gowtham
 */
const ALT =
  'A recording of nextship detect, then nextship deploy --yes: the plan, the build, the push to the registry, ' +
  'App Platform bringing the app live, and the URL it serves on.'

export function DeployRecording() {
  return (
    <figure>
      <div className="relative overflow-hidden rounded-2xl border border-border bg-[#282d35] shadow-[0_24px_80px_-32px_rgba(0,58,160,0.45)]">
        <BorderBeam size={160} duration={10} />
        <picture>
          <source media="(prefers-reduced-motion: reduce)" srcSet="/media/deploy-final.svg" />
          {/* A plain img: next/image cannot optimise an animated SVG, and the static export serves it as is. */}
          <img src="/media/deploy.svg" alt={ALT} width={1040} height={735} className="block h-auto w-full" />
        </picture>
      </div>
      <figcaption className="mt-3 text-center text-xs text-muted text-pretty">
        One uncut recording of a real deployment, 98 seconds shown in 43. Pauses over two seconds are shortened and
        nothing else is edited.{' '}
        <a href="/media/deploy.cast" className="underline decoration-border-strong underline-offset-2 hover:text-foreground">
          The recording
        </a>{' '}
        keeps the real timings.
      </figcaption>
    </figure>
  )
}
