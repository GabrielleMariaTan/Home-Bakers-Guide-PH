'use client';

import { useState } from 'react';
import { corpus } from '@/lib/corpus';
import type { SearchResult } from '@/lib/types';

/** Relevance label from cosine similarity — friendlier than a raw number. */
function relevance(score: number) {
  if (score >= 0.6) return { label: 'Strong match', cls: 'rel-strong' };
  if (score >= 0.45) return { label: 'Good match', cls: 'rel-good' };
  return { label: 'Weak match', cls: 'rel-weak' };
}

function SourceCard({ src, n, msgId }: { src: SearchResult; n: number; msgId: string }) {
  const [open, setOpen] = useState(false);
  const rel = relevance(src.score);
  const long = src.text.length > 280;
  const href = corpus.linkToPdfPages ? `/docs/${encodeURIComponent(src.source)}#page=${src.page}` : undefined;

  return (
    <li
      id={`${msgId}-src-${n}`}
      data-cite-page={src.page}
      data-cite-doc={src.title.split('·')[0].trim().toLowerCase()}
      className="source-card"
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <span className="source-num">{n}</span>
        <span className="font-semibold text-[color:var(--fg)]">{src.title}</span>
        <span className="source-page">p. {src.page}</span>
        {src.section && <span className="truncate text-[color:var(--muted)] max-w-[16rem]">§ {src.section}</span>}
        <span className={`rel ${rel.cls}`} title={`Cosine similarity ${src.score.toFixed(2)}`}>
          {rel.label} · {src.score.toFixed(2)}
        </span>
      </div>
      <p className={`mt-2 text-sm leading-relaxed text-[color:var(--fg-soft)] whitespace-pre-line ${open || !long ? '' : 'line-clamp-4'}`}>
        {src.text}
      </p>
      <div className="mt-1.5 flex gap-4 text-xs">
        {long && (
          <button type="button" className="link" onClick={() => setOpen((o) => !o)}>
            {open ? 'Show less' : 'Show full passage'}
          </button>
        )}
        {href && (
          <a className="link" href={href} target="_blank" rel="noreferrer">
            Open page {src.page} ↗
          </a>
        )}
      </div>
    </li>
  );
}

export function Sources({ sources, msgId }: { sources: SearchResult[]; msgId: string }) {
  const [open, setOpen] = useState(true);
  if (sources.length === 0) return null;
  const pages = [...new Set(sources.map((s) => s.page))].sort((a, b) => a - b);

  return (
    <section className="sources" aria-label="Sources">
      <button type="button" onClick={() => setOpen((o) => !o)} className="sources-toggle" aria-expanded={open}>
        <span aria-hidden>{open ? '▾' : '▸'}</span>
        Sources · {sources.length} passage{sources.length === 1 ? '' : 's'} from page{pages.length === 1 ? '' : 's'}{' '}
        {pages.join(', ')}
      </button>
      {open && (
        <ol className="mt-2 space-y-2">
          {sources.map((s, i) => (
            <SourceCard key={s.id} src={s} n={i + 1} msgId={msgId} />
          ))}
        </ol>
      )}
    </section>
  );
}
