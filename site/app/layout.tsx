import type { Metadata, Viewport } from 'next'
import { GeistMono } from 'geist/font/mono'
import { Plus_Jakarta_Sans } from 'next/font/google'

import { SiteFooter } from '@/components/site-footer'
import { SiteHeader } from '@/components/site-header'
import { THEME_SCRIPT } from '@/lib/theme'
import './globals.css'

const title = 'nextship'
const description =
  'Deploy any Next.js app to infrastructure you own. No Dockerfile, no config edits, no Terraform.'

/**
 * Where this site is served from.
 *
 * Open Graph and Twitter card image URLs have to be absolute, so Next.js needs
 * a base it cannot infer at build time. It is read from the environment rather
 * than hard coded to a domain nobody has registered: an invented URL would
 * produce card images that silently 404 wherever the page was shared.
 *
 * The localhost default is correct for development and for a build that has not
 * been given a home yet. Set NEXT_PUBLIC_SITE_URL when deploying.
 */
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'

/** The brand's typeface. Fetched once at build time and served with the site. */
const jakarta = Plus_Jakarta_Sans({ subsets: ['latin'], variable: '--font-jakarta' })

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { default: `${title}: deploy Next.js to your own cloud`, template: `%s | ${title}` },
  description,
  applicationName: title,
  authors: [{ name: 'Gowtham' }, { name: 'Ragul D' }],
  keywords: ['next.js', 'deployment', 'digitalocean', 'docker', 'self-hosting', 'adapter'],
  openGraph: { title, description, type: 'website', siteName: title },
  twitter: { card: 'summary', title, description },
  robots: { index: true, follow: true },
}

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#060b1a' },
  ],
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
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
          <SiteHeader />
          <main className="flex-1">{children}</main>
          <SiteFooter />
        </div>
      </body>
    </html>
  )
}
