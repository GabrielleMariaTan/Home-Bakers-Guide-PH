import type { Metadata, Viewport } from 'next';
import { corpus } from '@/lib/corpus';
import './globals.css';

// Vercel sets this automatically; used to build absolute Open Graph URLs.
const siteUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL
  ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  : 'http://localhost:3000';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: `${corpus.appName} — sell your baked goods legally`,
  description: corpus.tagline,
  openGraph: {
    title: corpus.appName,
    description: corpus.tagline,
    type: 'website',
    siteName: corpus.appName,
  },
  twitter: { card: 'summary_large_image', title: corpus.appName, description: corpus.tagline },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: corpus.accent,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,500;0,600;0,700;1,500;1,600&family=Manrope:wght@400;500;600;700&display=swap"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
