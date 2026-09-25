'use client';

import { useChat, type Message } from '@ai-sdk/react';
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { corpus } from '@/lib/corpus';
import manifest from '@/lib/manifest';
import type { SearchOutput, SearchResult } from '@/lib/types';
import { Markdown } from '@/components/Markdown';
import { Sources } from '@/components/Sources';

type Part = NonNullable<Message['parts']>[number];

/** All passages retrieved for one assistant message, de-duplicated, best first. */
function collectSources(m: Message): SearchResult[] {
  const byId = new Map<string, SearchResult>();
  for (const p of m.parts ?? []) {
    if (p.type !== 'tool-invocation') continue;
    const inv = p.toolInvocation;
    if (inv.toolName !== 'searchDocs' || inv.state !== 'result') continue;
    for (const r of (inv.result as SearchOutput).results ?? []) {
      const prev = byId.get(r.id);
      if (!prev || prev.score < r.score) byId.set(r.id, r);
    }
  }
  return [...byId.values()].sort((a, b) => b.score - a.score);
}

function ToolStatus({ part }: { part: Extract<Part, { type: 'tool-invocation' }> }) {
  const inv = part.toolInvocation;
  if (inv.toolName !== 'searchDocs') return null;
  const q = (inv.args as { query?: string })?.query;
  if (inv.state !== 'result') {
    return (
      <div className="tool-status">
        <span className="spinner" aria-hidden /> Searching the documents{q ? <> for “{q}”</> : '…'}
      </div>
    );
  }
  const n = (inv.result as SearchOutput).results?.length ?? 0;
  return (
    <div className="tool-status done">
      <span aria-hidden>⌕</span> Searched “{q}” · {n === 0 ? 'no relevant passages' : `${n} passage${n === 1 ? '' : 's'}`}
    </div>
  );
}

function AssistantMessage({ m, busy }: { m: Message; busy: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const sources = collectSources(m);
  const usedTool = (m.parts ?? []).some((p) => p.type === 'tool-invocation');
  const hasText = (m.parts ?? []).some((p) => p.type === 'text' && p.text.trim());

  const onCite = (page: number, doc: string) => {
    const cards = [...(ref.current?.querySelectorAll<HTMLElement>(`[data-cite-page="${page}"]`) ?? [])];
    const want = doc.toLowerCase();
    const el =
      cards.find((c) => want && (c.dataset.citeDoc === want || want.startsWith(c.dataset.citeDoc ?? '\u0000'))) ?? cards[0];
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.remove('flash');
    void el.offsetWidth; // restart animation
    el.classList.add('flash');
  };

  return (
    <div ref={ref} className="assistant">
      <div className="avatar" aria-hidden>
        {corpus.appName.charAt(0)}
      </div>
      <div className="min-w-0 flex-1">
        {(m.parts ?? []).map((p, i) => {
          if (p.type === 'tool-invocation') return <ToolStatus key={i} part={p} />;
          if (p.type === 'text' && p.text.trim()) return <Markdown key={i} text={p.text} onCite={onCite} />;
          return null;
        })}
        {busy && !hasText && !usedTool && <div className="tool-status"><span className="spinner" aria-hidden /> Thinking…</div>}
        <Sources sources={sources} msgId={m.id} />
        {!busy && hasText && !usedTool && (
          <p className="mt-2 text-xs text-[color:var(--muted)]">Answered without searching the documents.</p>
        )}
      </div>
    </div>
  );
}

function Ticker({ onPick }: { onPick: (q: string) => void }) {
  const items = [...corpus.ticker, ...corpus.ticker]; // duplicated for a seamless loop
  return (
    <div className="ticker" aria-label="Popular topics">
      <div className="ticker-track">
        {items.map((t, i) => (
          <button
            key={i}
            type="button"
            className="ticker-item"
            tabIndex={i < corpus.ticker.length ? 0 : -1}
            aria-hidden={i >= corpus.ticker.length}
            onClick={() => onPick(`What do the documents say about ${t.toLowerCase()}?`)}
          >
            <span aria-hidden>✦</span> {t}
          </button>
        ))}
      </div>
    </div>
  );
}

function EmptyState({ onPick }: { onPick: (q: string) => void }) {
  return (
    <div className="hero">
      <p className="eyebrow">Home Baker&apos;s Guide · Philippines</p>
      <h2 className="hero-title">{corpus.heroTitle}</h2>
      <p className="hero-sub">{corpus.tagline}</p>

      <div className="steps">
        {corpus.journey.map((j) => (
          <article key={j.step} className="step-card">
            <div className="step-num">{j.step}</div>
            <h3 className="step-title">{j.title}</h3>
            <p className="step-source">{j.source}</p>
            <p className="step-blurb">{j.blurb}</p>
            <div className="step-qs">
              {j.questions.map((q) => (
                <button key={q} type="button" className="step-q" onClick={() => onPick(q)}>
                  {q}
                  <span aria-hidden>→</span>
                </button>
              ))}
            </div>
          </article>
        ))}
      </div>

      <div className="tips">
        <div className="tip">
          <span className="tip-icon" aria-hidden>
            ✓
          </span>
          <span>Ask one specific thing at a time.</span>
        </div>
        <div className="tip">
          <span className="tip-icon" aria-hidden>
            §
          </span>
          <span>
            Every claim cites a page. Click <span className="cite-chip">p. 3</span> to see the passage.
          </span>
        </div>
        <div className="tip">
          <span className="tip-icon" aria-hidden>
            ?
          </span>
          <span>If it isn&apos;t in the documents, I&apos;ll say so instead of guessing.</span>
        </div>
      </div>
      <p className="mt-6 text-[11px] leading-relaxed text-[color:var(--muted)] sm:hidden">{corpus.disclaimer}</p>
    </div>
  );
}

function Sidebar({ open, onClose, onNew, hasChat }: { open: boolean; onClose: () => void; onNew: () => void; hasChat: boolean }) {
  return (
    <>
      <div className={`scrim ${open ? 'show' : ''}`} onClick={onClose} aria-hidden />
      <aside className={`sidebar ${open ? 'open' : ''}`} aria-label="About this guide">
        <div className="brand">
          <div className="logo" aria-hidden>
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 14c0-4 3.6-7 8-7s8 3 8 7" />
              <path d="M3 14h18l-1.5 5.2a1.5 1.5 0 0 1-1.4 1.1H5.9a1.5 1.5 0 0 1-1.4-1.1L3 14Z" />
              <path d="M9 7.5c0-1.7 1.3-3 3-3s3 1.3 3 3" />
            </svg>
          </div>
          <div>
            <div className="brand-name">{corpus.appName}</div>
            <div className="brand-line">{corpus.brandLine}</div>
          </div>
        </div>

        <button type="button" className="btn-primary w-full" onClick={onNew} disabled={!hasChat}>
          + New chat
        </button>

        <nav className="side-section">
          <h3>Your path to selling</h3>
          <ol className="path">
            {corpus.journey.map((j) => (
              <li key={j.step}>
                <span className="path-num">{j.step}</span>
                <span>
                  <strong>{j.title}</strong>
                  <em>{j.source}</em>
                </span>
              </li>
            ))}
          </ol>
        </nav>

        <section className="side-section">
          <h3>What I&apos;ve read</h3>
          {manifest.documents.length === 0 ? (
            <p className="side-note">No documents indexed yet. Run npm run seed.</p>
          ) : (
            <ul className="docs">
              {manifest.documents.map((d) => (
                <li key={d.source}>
                  <a href={`/docs/${encodeURIComponent(d.source)}`} target="_blank" rel="noreferrer">
                    {d.title}
                  </a>
                  <span>{d.pages} pages</span>
                </li>
              ))}
            </ul>
          )}
          <p className="side-note">
            {manifest.totalPages} pages · checked against fda.gov.ph {corpus.asOf}
          </p>
        </section>

        <p className="side-disclaimer">{corpus.disclaimer}</p>
      </aside>
    </>
  );
}

export default function Page() {
  const { messages, input, setInput, handleInputChange, handleSubmit, append, status, error, reload, stop, setMessages } =
    useChat({ api: '/api/chat' });

  const busy = status === 'submitted' || status === 'streaming';
  const [navOpen, setNavOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (messages.length) bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, status]);

  const ask = (q: string) => {
    if (busy) return;
    setNavOpen(false);
    append({ role: 'user', content: q });
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!input.trim() || busy) return;
    handleSubmit(e);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      e.currentTarget.form?.requestSubmit();
    }
  };

  const reset = () => {
    stop();
    setMessages([]);
    setInput('');
    setNavOpen(false);
    inputRef.current?.focus();
  };

  return (
    <div className="shell">
      <Sidebar open={navOpen} onClose={() => setNavOpen(false)} onNew={reset} hasChat={messages.length > 0} />

      <div className="content">
        <header className="mobile-bar">
          <button type="button" className="icon-btn" aria-label="Open menu" onClick={() => setNavOpen(true)}>
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M4 7h16M4 12h16M4 17h16" />
            </svg>
          </button>
          <span className="brand-name">{corpus.appName}</span>
          {messages.length > 0 ? (
            <button type="button" className="icon-btn" aria-label="New chat" onClick={reset}>
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>
          ) : (
            <span className="w-9" />
          )}
        </header>

        <Ticker onPick={ask} />

        <main className="chat">
          {messages.length === 0 ? (
            <EmptyState onPick={ask} />
          ) : (
            <ul className="space-y-7">
              {messages.map((m, i) => (
                <li key={m.id}>
                  {m.role === 'user' ? (
                    <div className="flex justify-end">
                      <div className="user-bubble">{m.content}</div>
                    </div>
                  ) : (
                    <AssistantMessage m={m} busy={busy && i === messages.length - 1} />
                  )}
                </li>
              ))}
              {status === 'submitted' && messages.at(-1)?.role === 'user' && (
                <li>
                  <div className="assistant">
                    <div className="avatar" aria-hidden>
                      {corpus.appName.charAt(0)}
                    </div>
                    <div className="tool-status">
                      <span className="spinner" aria-hidden /> Thinking…
                    </div>
                  </div>
                </li>
              )}
              {error && (
                <li className="error-box" role="alert">
                  <span>Something went wrong: {error.message || 'request failed'}.</span>
                  <button type="button" className="link" onClick={() => reload()}>
                    Try again
                  </button>
                </li>
              )}
            </ul>
          )}
          <div ref={bottomRef} />
        </main>

        <footer className="composer-wrap">
          <form onSubmit={onSubmit} className="composer">
            <textarea
              ref={inputRef}
              value={input}
              onChange={handleInputChange}
              onKeyDown={onKeyDown}
              rows={1}
              maxLength={2000}
              placeholder={corpus.placeholder}
              aria-label="Your question"
              className="composer-input"
            />
            {busy ? (
              <button type="button" onClick={stop} className="btn-primary" aria-label="Stop generating">
                Stop
              </button>
            ) : (
              <button type="submit" disabled={!input.trim()} className="btn-primary">
                Ask
              </button>
            )}
          </form>
          <p className="composer-note">{corpus.disclaimer}</p>
        </footer>
      </div>
    </div>
  );
}
