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
      <body>{children}</body>
    </html>
  );
}
