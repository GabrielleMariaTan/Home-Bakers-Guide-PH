/**
 * Seed Upstash Vector with every PDF in data/.
 *
 *   npm run seed            # chunk, embed, upsert
 *   npm run seed -- --dry   # chunk only: print stats + write .seed-preview.json (no API calls)
 *   npm run seed -- --reset # wipe the index first (use after changing chunk settings)
 *
 * What changed vs. the workshop starter:
 *  - Real per-page extraction. The starter split on "\f", which pdf-parse never
 *    emits, so every chunk was tagged page 1. We render each page separately.
 *  - Multiple PDFs, with `source` (file) and `title` metadata on every chunk.
 *  - Repeated headers/footers are stripped before chunking.
 *  - Sentence-aware packing with overlap, plus the nearest section heading is
 *    stored as metadata and prepended to the embedded text for better recall.
 *  - Loads .env.local (the starter's `dotenv/config` only read .env).
 *  - Writes lib/corpus-manifest.json so the UI can show what's indexed.
 */
import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local' });
loadEnv();

import fs from 'node:fs/promises';
import path from 'node:path';
import { Index } from '@upstash/vector';
import { embedMany } from 'ai';
import { openai } from '@ai-sdk/openai';
// Import the inner module: the package entry has a debug branch that can try
// to read a test PDF when loaded from ESM.
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import { chunking, corpus } from './corpus';

const DATA_DIR = path.join(process.cwd(), 'data');
const PUBLIC_DOCS_DIR = path.join(process.cwd(), 'public', 'docs');
const MANIFEST_PATH = path.join(process.cwd(), 'lib', 'corpus-manifest.json');
const PREVIEW_PATH = path.join(process.cwd(), '.seed-preview.json');

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has('--dry') || args.has('--dry-run');
const RESET = args.has('--reset');

import type { ChunkMeta } from './types';

// ---------------------------------------------------------------- extraction

/** Render one page into lines, keeping the line breaks pdf.js reports. */
async function renderPage(pageData: any): Promise<string> {
  const content = await pageData.getTextContent({
    normalizeWhitespace: true,
    disableCombineTextItems: false,
  });
  let lastY: number | undefined;
  let text = '';
  for (const item of content.items as { str: string; transform: number[] }[]) {
    const y = item.transform[5];
    if (lastY === undefined || Math.abs(lastY - y) < 2) text += item.str;
    else text += '\n' + item.str;
    lastY = y;
  }
  // Marker so we can split pages reliably afterwards.
  return `${text}\n<<<PAGE_BREAK>>>`;
}

async function extractPages(file: string): Promise<{ pages: string[]; title: string }> {
  const buf = await fs.readFile(file);
  const parsed = await pdfParse(buf, { pagerender: renderPage });
  const pages = parsed.text
    .split('<<<PAGE_BREAK>>>')
    .slice(0, parsed.numpages)
    .map((p: string) => p.replace(/^\n+/, ''));
  const metaTitle = (parsed.info?.Title as string | undefined)?.trim();
  const base = path.basename(file);
  const title =
    corpus.documentTitles[base] ??
    (metaTitle && metaTitle.length > 3 && !/^untitled|microsoft word|anonymous|scanned|\.pdf$/i.test(metaTitle)
      ? metaTitle
      : prettyName(base));
  return { pages, title };
}

function prettyName(file: string): string {
  return file
    .replace(/\.pdf$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ------------------------------------------------------------------ cleaning

/**
 * Normalise a line for header/footer detection. Digits are only masked on
 * lines that look like page labels ("Page 3 of 40", "- 12 -"), so numbered
 * headings like "3. Refunds" are never mistaken for boilerplate.
 */
const lineKey = (l: string) => {
  const t = l.trim().toLowerCase();
  return /\bpage\b|^[\s\d\-–|/of]+$/.test(t) ? t.replace(/\d+/g, '#') : t;
};

/**
 * Lines that repeat on many pages (running headers, footers, page numbers)
 * add noise to every chunk and pull unrelated chunks together in vector space.
 */
function findBoilerplate(pages: string[]): Set<string> {
  if (pages.length < 4) return new Set();
  const counts = new Map<string, number>();
  for (const p of pages) {
    const lines = p.split('\n').map((l) => l.trim()).filter(Boolean);
    const edges = new Set([...lines.slice(0, 3), ...lines.slice(-3)].map(lineKey));
    edges.forEach((k) => counts.set(k, (counts.get(k) ?? 0) + 1));
  }
  const threshold = Math.max(3, Math.ceil(pages.length * 0.4));
  return new Set([...counts].filter(([k, n]) => n >= threshold && k.length < 120).map(([k]) => k));
}

/**
 * Heading detector tuned for Philippine administrative orders, which number
 * *everything*: "1.2 Hygienic Practices" is a heading, but
 * "1.4.2 Approve/reject product manufactured or packed..." is a clause.
 * So a numbered line only counts as a heading if the words after the number
 * are short and Title Case / ALL CAPS.
 */
function isHeading(line: string): boolean {
  const l = line.trim();
  if (l.length < 3 || l.length > 80) return false;
  if (/[.,;:]$/.test(l)) return false;
  // Strip a leading "1.", "1.2.3", "IV.", "A." or "Section 5" label.
  const body = l
    .replace(/^(chapter|section|part|article|appendix)\s+[\w.]+\s*[-–—:]?\s*/i, '')
    .replace(/^([0-9]+(\.[0-9]+)*\.?|[IVXLCl]{1,5}\.|[A-Z]\.)\s+/, '');
  if (!body || body.length < 3) return false;
  if ((body.match(/\d/g) ?? []).length > 2) return false; // "Php 2,000 + 1% LRF" is not a heading
  if (/[—–-]\s+[A-Z]/.test(body) && body.split(/\s+/).length > 4) return false; // "Accuracy — An indicator of…" is a definition
  const words = body.split(/\s+/);
  if (words.length > 8) return false;
  const letters = body.replace(/[^A-Za-z]/g, '');
  if (letters.length >= 4 && letters === letters.toUpperCase()) return true; // ALL CAPS
  const small = /^(of|and|or|the|a|an|in|on|for|to|with|by|at|from|per)$/i;
  const content = words.filter((w) => !small.test(w));
  const capped = content.filter((w) => /^[A-Z(]/.test(w)).length;
  return content.length > 0 && capped / content.length >= 0.75; // Title Case
}

type Block = { text: string; section: string };

/** Turn a page into prose blocks, tracking the most recent heading. */
function pageToBlocks(raw: string, boiler: Set<string>, carrySection: string) {
  let lines = raw
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l && !corpus.dropLinePatterns.some((re) => re.test(l)));
  // Only strip boilerplate at the top/bottom edges of the page, never mid-body.
  const isBoiler = (l: string) => boiler.has(lineKey(l)) || /^(page\s*)?\d{1,4}(\s*(of|\/)\s*\d+)?$/i.test(l);
  for (let k = 0; k < 3 && lines.length && isBoiler(lines[0]); k++) lines.shift();
  for (let k = 0; k < 3 && lines.length && isBoiler(lines[lines.length - 1]); k++) lines.pop();
  const blocks: Block[] = [];
  let section = carrySection;
  let buf = '';
  const flush = () => {
    const t = buf.trim();
    if (t) blocks.push({ text: t, section });
    buf = '';
  };
  for (const line of lines) {
    if (!line) continue;
    if (isHeading(line) && buf.length > 0 && /[.!?:)"”]$/.test(buf.trim())) {
      flush();
      section = line;
      continue;
    }
    if (isHeading(line) && buf.length === 0) {
      section = line;
      continue;
    }
    // Re-join words hyphenated across a line break: "retriev-\nal" -> "retrieval".
    if (buf.endsWith('-') && /^[a-z]/.test(line)) buf = buf.slice(0, -1) + line;
    else buf += (buf ? ' ' : '') + line;
  }
  flush();
  return { blocks, section };
}

// ------------------------------------------------------------------ chunking

function splitSentences(text: string): string[] {
  return text.match(/[^.!?]+(?:[.!?]+["”')\]]*|$)\s*/g)?.map((s) => s.trim()).filter(Boolean) ?? [text];
}

/**
 * Pack sentences into ~chunkSize windows. Never cuts mid-sentence (unless a
 * single sentence is longer than the window). Overlap = trailing sentences of
 * the previous chunk, up to chunkOverlap characters.
 */
function packChunks(blocks: Block[]): Block[] {
  const { chunkSize, chunkOverlap } = chunking;
  const out: Block[] = [];
  let cur: string[] = [];
  let curLen = 0;
  let curSection = blocks[0]?.section ?? '';

  const emit = () => {
    if (!cur.length) return;
    out.push({ text: cur.join(' '), section: curSection });
    // build overlap tail
    const tail: string[] = [];
    let len = 0;
    for (let i = cur.length - 1; i >= 0; i--) {
      if (len + cur[i].length > chunkOverlap) break;
      tail.unshift(cur[i]);
      len += cur[i].length + 1;
    }
    cur = tail;
    curLen = len;
  };

  for (const b of blocks) {
    if (b.section !== curSection && curLen > chunking.minChunkChars) {
      emit();
      cur = []; // don't carry overlap across a section boundary
      curLen = 0;
    }
    curSection = b.section;
    for (let s of splitSentences(b.text)) {
      while (s.length > chunkSize) {
        // pathological run-on (tables, lists): hard split
        if (curLen) emit();
        out.push({ text: s.slice(0, chunkSize), section: curSection });
        s = s.slice(chunkSize - chunkOverlap);
        cur = [];
        curLen = 0;
      }
      if (curLen + s.length + 1 > chunkSize && curLen > 0) emit();
      cur.push(s);
      curLen += s.length + 1;
    }
  }
  if (cur.length && (out.length === 0 || curLen > chunkOverlap + 20)) {
    out.push({ text: cur.join(' '), section: curSection });
  }
  return out.filter((c) => c.text.length >= chunking.minChunkChars);
}

// ---------------------------------------------------------------------- main

const slug = (s: string) =>
  s.toLowerCase().replace(/\.pdf$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Text that gets embedded: title + section give the vector context the chunk lacks on its own. */
const embedText = (c: ChunkMeta) =>
  [`Document: ${c.title}`, c.section && `Section: ${c.section}`, c.text].filter(Boolean).join('\n');

async function main() {
  const files = (await fs.readdir(DATA_DIR).catch(() => [] as string[]))
    .filter((f) => f.toLowerCase().endsWith('.pdf'))
    .sort();
  if (files.length === 0) {
    console.error(`No PDFs found in ${DATA_DIR}. Put your documents there and re-run.`);
    process.exit(1);
  }

  const all: { id: string; meta: ChunkMeta }[] = [];
  const manifestDocs: { source: string; title: string; pages: number; chunks: number }[] = [];

  for (const file of files) {
    const { pages, title } = await extractPages(path.join(DATA_DIR, file));
    const boiler = findBoilerplate(pages);
    let section = '';
    let docChunks = 0;
    pages.forEach((raw, i) => {
      const res = pageToBlocks(raw, boiler, section);
      section = res.section;
      packChunks(res.blocks).forEach((c, j) => {
        const meta: ChunkMeta = { text: c.text, source: file, title, page: i + 1, section: c.section, chunk: j };
        all.push({ id: `${slug(file)}-p${i + 1}-c${j}`, meta });
        docChunks++;
      });
    });
    const emptyPages = pages.filter((p) => p.trim().length < 20).length;
    console.log(
      `• ${file}: "${title}" — ${pages.length} pages, ${docChunks} chunks` +
        (boiler.size ? `, stripped ${boiler.size} header/footer pattern(s)` : '') +
        (emptyPages ? `, ⚠ ${emptyPages} page(s) with no text (scanned images?)` : ''),
    );
    manifestDocs.push({ source: file, title, pages: pages.length, chunks: docChunks });
  }

  const lens = all.map((c) => c.meta.text.length).sort((a, b) => a - b);
  const pct = (p: number) => lens[Math.min(lens.length - 1, Math.floor(p * lens.length))];
  console.log(
    `\nTotal: ${all.length} chunks · length min ${lens[0]} / median ${pct(0.5)} / p95 ${pct(0.95)} / max ${lens.at(-1)} chars` +
      ` · settings size=${chunking.chunkSize} overlap=${chunking.chunkOverlap}`,
  );

  const manifest = {
    generatedAt: new Date().toISOString(),
    chunkSize: chunking.chunkSize,
    chunkOverlap: chunking.chunkOverlap,
    totalChunks: all.length,
    totalPages: manifestDocs.reduce((n, d) => n + d.pages, 0),
    documents: manifestDocs,
  };
  await fs.writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n');

  // Copy PDFs so source cards can deep-link to pages (see corpus.linkToPdfPages).
  await fs.mkdir(PUBLIC_DOCS_DIR, { recursive: true });
  for (const f of files) await fs.copyFile(path.join(DATA_DIR, f), path.join(PUBLIC_DOCS_DIR, f));

  if (DRY_RUN) {
    await fs.writeFile(PREVIEW_PATH, JSON.stringify(all.map((c) => ({ id: c.id, ...c.meta })), null, 2));
    console.log(`\nDry run: wrote ${PREVIEW_PATH} — open it to eyeball chunks. Nothing was embedded.`);
    return;
  }

  if (!process.env.UPSTASH_VECTOR_REST_URL || !process.env.UPSTASH_VECTOR_REST_TOKEN) {
    console.error('Missing UPSTASH_VECTOR_REST_URL / UPSTASH_VECTOR_REST_TOKEN. Set them in .env.local.');
    process.exit(1);
  }
  if (!process.env.OPENAI_API_KEY) {
    console.error('Missing OPENAI_API_KEY in .env.local.');
    process.exit(1);
  }

  const index = new Index();
  if (RESET) {
    console.log('Resetting index…');
    await index.reset();
  }

  const BATCH = 100;
  for (let i = 0; i < all.length; i += BATCH) {
    const batch = all.slice(i, i + BATCH);
    const { embeddings } = await embedMany({
      model: openai.embedding('text-embedding-3-small'),
      values: batch.map((c) => embedText(c.meta)),
    });
    await index.upsert(
      batch.map((c, j) => ({ id: c.id, vector: embeddings[j], metadata: c.meta })),
    );
    process.stdout.write(`\rEmbedded + upserted ${Math.min(i + BATCH, all.length)}/${all.length}`);
  }

  const info = await index.info();
  console.log(`\nIndex now holds ${info.vectorCount} vectors (dimension ${info.dimension}).`);
  if (info.vectorCount > all.length) {
    console.log('⚠ The index has more vectors than this run produced — stale chunks remain. Re-run with --reset.');
  }
  console.log('✅ Done. Run `npm run dev` and chat at http://localhost:3000');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
