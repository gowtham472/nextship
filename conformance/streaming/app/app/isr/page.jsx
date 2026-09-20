// An ISR page, for the durability claim the VM target is built on: what Next.js
// regenerates at runtime is written into `.next/server/app`, which lives in a
// volume, so it has to survive the container being restarted.
//
// The value is read at render rather than at build, so a regenerated page is
// visibly different from the one the build produced, and identical across two
// reads of the same cached entry. That is what makes "it survived a restart"
// distinguishable from "it was rendered again after the restart".
export const revalidate = 31536000

export default function Isr() {
  return <p id="stamp">{`isr-${Date.now()}`}</p>
}
