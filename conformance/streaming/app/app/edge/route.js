// Edge runtime code must survive the prune: its bundles are not in the build's trace
// output, so a pruning change could drop them and the route would fail only in the image.
// The response names the runtime the code actually ran in.
export const runtime = 'edge'

export function GET() {
  return Response.json({ runtime: typeof EdgeRuntime === 'string' ? EdgeRuntime : null })
}
