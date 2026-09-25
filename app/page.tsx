'use client';

import { useChat, type Message } from '@ai-sdk/react';
import { useEffect, useRef, type FormEvent, type KeyboardEvent } from 'react';
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

function EmptyState({ onPick }: { onPick: (q: string) => void }) {
  const docs = manifest.documents;
  return (
    <div className="empty">
      <div className="empty-badge" aria-hidden>
        {corpus.appName.charAt(0)}
      </div>
      <h2 className="text-xl font-semibold tracking-tight">What do you want to know?</h2>
      <p className="mt-1 max-w-lg text-sm text-[color:var(--muted)]">{corpus.tagline}</p>

      <div className="mt-6 grid w-full gap-2 sm:grid-cols-2">
        {corpus.sampleQuestions.map((q) => (
          <button key={q} type="button" className="suggestion" onClick={() => onPick(q)}>
            {q}
          </button>
        ))}
      </div>

      <div className="mt-8 grid w-full gap-4 text-left text-sm sm:grid-cols-2">
        <div className="info-card">
          <h3>What I&apos;ve read</h3>
          {docs.length === 0 ? (
            <p>No documents indexed yet — run <code>npm run seed</code>.</p>
          ) : (
            <ul>
              {docs.map((d) => (
                <li key={d.source}>
                  <span className="font-medium text-[color:var(--fg)]">{d.title}</span>
                  <span className="text-[color:var(--muted)]"> · {d.pages} pages</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-[color:var(--muted)]">Checked against fda.gov.ph: {corpus.asOf}</p>
        </div>
        <div className="info-card">
          <h3>How to get good answers</h3>
          <ul>
            <li>Ask one specific thing at a time.</li>
            <li>Every claim cites a page — click <span className="cite-chip">p. 3</span> to see the passage.</li>
            <li>If it isn&apos;t in the documents, I&apos;ll say so instead of guessing.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

export default function Page() {
  const { messages, input, setInput, handleInputChange, handleSubmit, append, status, error, reload, stop, setMessages } =
    useChat({ api: '/api/chat' });

  const busy = status === 'submitted' || status === 'streaming';
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, status]);

  const ask = (q: string) => {
    if (busy) return;
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
    inputRef.current?.focus();
  };

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="topbar">
        <div className="mx-auto flex w-full max-w-3xl items-center gap-3 px-4 py-3">
          <div className="logo" aria-hidden>
            {corpus.appName.charAt(0)}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-base font-semibold leading-tight">{corpus.appName}</h1>
            <p className="truncate text-xs text-[color:var(--muted)]">
              {manifest.totalPages
                ? `${manifest.documents.length} document${manifest.documents.length === 1 ? '' : 's'} · ${manifest.totalPages} pages indexed`
                : 'No documents indexed yet'}
            </p>
          </div>
          {messages.length > 0 && (
            <button type="button" onClick={reset} className="btn-ghost">
              New chat
            </button>
          )}
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-40 pt-6">
        {messages.length === 0 ? (
          <EmptyState onPick={ask} />
        ) : (
          <ul className="space-y-6">
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
        <form onSubmit={onSubmit} className="composer mx-auto max-w-3xl">
          <textarea
            ref={inputRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={onKeyDown}
            rows={1}
            maxLength={2000}
            autoFocus
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
        <p className="mx-auto mt-2 max-w-3xl px-1 text-center text-[11px] text-[color:var(--muted)]">
          {corpus.disclaimer}
        </p>
      </footer>
    </div>
  );
}
