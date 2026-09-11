import { Suspense } from 'react'

// Rendered per request, so the response is streamed rather than served from a
// prerendered file.
export const dynamic = 'force-dynamic'

async function Tail() {
  await new Promise((resolve) => setTimeout(resolve, 2000))
  return <p id="tail">stream-tail</p>
}

// The shell renders at once; the tail arrives two seconds later behind the boundary.
// measure.mjs asserts the shell reaches the client before the tail exists.
export default function Stream() {
  return (
    <main>
      <p id="shell">stream-shell</p>
      <Suspense fallback={<p>waiting</p>}>
        <Tail />
      </Suspense>
    </main>
  )
}
