import { DocsMobileNav } from '@/components/docs/mobile-nav'
import { DocsSidebar } from '@/components/docs-sidebar'

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-7xl px-5 sm:px-8">
      <DocsMobileNav />
      <div className="lg:grid lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-12">
        {/*
          Sticky below the 4rem header rather than the viewport top, so a long
          outline scrolls independently instead of hiding behind the header.
          Under lg the mobile bar above opens the same outline in a sheet.
        */}
        <aside className="hidden lg:block">
          <div className="sticky top-16 max-h-[calc(100vh-4rem)] overflow-y-auto py-12 pr-3">
            <DocsSidebar />
          </div>
        </aside>

        {children}
      </div>
    </div>
  )
}
