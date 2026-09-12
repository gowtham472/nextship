import type { Metadata, Viewport } from 'next'
import { GeistMono } from 'geist/font/mono'
import { Plus_Jakarta_Sans } from 'next/font/google'

import { SiteFooter } from '@/components/site-footer'
import { SiteHeader } from '@/components/site-header'
import { getSearchIndex } from '@/lib/search'
import { SITE_URL } from '@/lib/site'
import { THEME_SCRIPT } from '@/lib/theme'
import './globals.css'

const title = 'nextship'
const description =
  'Deploy any Next.js app to infrastructure you own. No Dockerfile, no config edits, no Terraform.'

/** The brand's typeface. Fetched once at build time and served with the site. */
const jakarta = Plus_Jakarta_Sans({ subsets: ['latin'], variable: '--font-jakarta' })

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  alternates: { canonical: '/' },
  title: { default: `${title}: deploy Next.js to your own cloud`, template: `%s | ${title}` },
  description,
  applicationName: title,
  authors: [{ name: 'Gowtham' }, { name: 'Ragul D' }],
  keywords: ['next.js', 'deployment', 'digitalocean', 'docker', 'self-hosting', 'adapter'],
  openGraph: { title, description, type: 'website', siteName: title },
  twitter: { card: 'summary_large_image', title, description },
  robots: { index: true, follow: true },
}

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#060b1a' },
  ],
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const searchEntries = await getSearchIndex()

  return (
    <html lang="en" className={`${jakarta.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <head>
        {/*
          Runs before the first paint, so a visitor who chose a theme never sees
          the other one flash first. It is inline for the same reason: an
          external file would arrive too late to matter.
        */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="font-sans antialiased">
        <div className="flex min-h-screen flex-col">
          <SiteHeader searchEntries={searchEntries} />
          <main className="flex-1">{children}</main>
          <SiteFooter />
        </div>
      </body>
    </html>
  )
}
