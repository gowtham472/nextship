import { DocsSidebar } from '@/components/docs-sidebar'

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-6xl px-5 sm:px-8">
      <div className="lg:grid lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-12">
        {/*
          Sticky below the 4rem header rather than the viewport top, so a long
          outline scrolls independently instead of hiding behind the header.
          Hidden under lg, where the outline would take the whole first screen.
        */}
        <aside className="hidden lg:block">
          <div className="sticky top-16 max-h-[calc(100vh-4rem)] overflow-y-auto py-10 pr-2">
            <DocsSidebar />
          </div>
        </aside>

        {children}
      </div>
    </div>
  )
}
