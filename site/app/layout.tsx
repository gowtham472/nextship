import type { Metadata, Viewport } from 'next'
import { GeistMono } from 'geist/font/mono'
import { GeistSans } from 'geist/font/sans'

import { SiteFooter } from '@/components/site-footer'
import { SiteHeader } from '@/components/site-header'
import { THEME_SCRIPT } from '@/lib/theme'
import './globals.css'

const title = 'nextship'
const description =
  'Deploy any Next.js app to infrastructure you own. No Dockerfile, no config edits, no Terraform.'

export const metadata: Metadata = {
  metadataBase: new URL('https://nextship.dev'),
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
    { media: '(prefers-color-scheme: dark)', color: '#000000' },
  ],
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
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
          <SiteHeader />
          <main className="flex-1">{children}</main>
          <SiteFooter />
        </div>
      </body>
    </html>
  )
}
