'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Renders assistant markdown. Inline citations like [p. 12] or
 * [Handbook, p. 12] become small chips; clicking one scrolls to and
 * highlights the matching source card under the answer.
 */
const CITE_RE = /\[((?:[^\]\[]*?,\s*)?pp?\.\s*(\d+)(?:\s*[–-]\s*\d+)?)\]/g;

export function Markdown({ text, onCite }: { text: string; onCite: (page: number, doc: string) => void }) {
  const withCites = text.replace(
    CITE_RE,
    (_m, label: string, page: string) => `[${label}](#cite-${page}-${encodeURIComponent(label.split(',')[0].trim())})`,
  );

  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => {
            if (href?.startsWith('#cite-')) {
              const [, page, doc = ''] = href.match(/^#cite-(\d+)-?(.*)$/) ?? [];
              return (
                <button
                  type="button"
                  onClick={() => onCite(Number(page), decodeURIComponent(doc))}
                  className="cite-chip"
                  title={`Jump to the source from page ${page}`}
                >
                  {children}
                </button>
              );
            }
            return (
              <a href={href} target="_blank" rel="noreferrer">
                {children}
              </a>
            );
          },
        }}
      >
        {withCites}
      </ReactMarkdown>
    </div>
  );
}
