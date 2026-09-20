// Regenerates the ISR page on demand, so a test does not have to wait out a
// revalidate window to produce a cache entry that differs from the build's.
import { revalidatePath } from 'next/cache'

export const dynamic = 'force-dynamic'

export async function POST() {
  revalidatePath('/isr')
  return Response.json({ revalidated: true })
}
