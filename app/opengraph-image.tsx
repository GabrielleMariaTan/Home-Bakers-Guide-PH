import { ImageResponse } from 'next/og';
import { corpus } from '@/lib/corpus';
import manifest from '@/lib/manifest';

// Link-preview image (Slack, LinkedIn, iMessage…), generated at build time.
export const alt = corpus.appName;
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: 72,
          background: '#fbf6ef',
          color: '#2e211b',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
          <div
            style={{
              width: 88,
              height: 88,
              borderRadius: 44,
              background: corpus.accent,
              color: 'white',
              fontSize: 56,
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {corpus.appName.charAt(0)}
          </div>
          <div style={{ fontSize: 60, fontWeight: 700 }}>{corpus.appName}</div>
        </div>
        <div style={{ fontSize: 38, lineHeight: 1.3, color: '#54423a', maxWidth: 1000 }}>{corpus.tagline}</div>
        <div style={{ display: 'flex', fontSize: 26, color: corpus.accent, fontWeight: 600 }}>
          {`${manifest.totalPages} pages indexed · answers cite their pages`}
        </div>
      </div>
    ),
    size,
  );
}
