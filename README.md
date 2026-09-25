# Home Baker's Guide PH

A public, streaming chat app for **home-based bakers in the Philippines who want to start selling, or grow into a registered food business, under FDA rules.** It answers questions about food labeling, Good Manufacturing Practice and the FDA License to Operate, and cites the exact page behind every claim.

> Information only, not legal advice. Documents checked against fda.gov.ph in September 2026.

**Live app:** https://YOUR-APP.vercel.app  ·  **Repo:** https://github.com/GabrielleMariaTan/Home-Bakers-Guide-PH  ·  **Stack:** Next.js 15 · Vercel AI SDK 4 (`streamText` + tools) · Upstash Vector · OpenAI `gpt-4o-mini` + `text-embedding-3-small`

---

## How it works

```
 browser (useChat)                    /api/chat (server only)                 Upstash Vector
 ───────────────────                  ───────────────────────                 ──────────────
 question ───────────────────────▶    streamText(gpt-4o-mini, tools)
                                        │ model decides: search or not?
                                        ├─ small talk → answers directly
                                        └─ substantive → searchDocs({query}) ──▶ embed query
                                                                                 topK=5, cosine
                        ◀── streamed tool status ──┘      results ≥ minScore ◀── chunk text + metadata
 tokens stream in ◀────── answer with [p. N] cites (up to 3 searches, then answer)
 Sources panel  ◀──────── tool results rendered under the answer
```

- **RAG is a tool call, not prepended context.** The model gets one tool, `searchDocs`. It calls it for substantive questions, rewrites follow-ups ("what about for contractors?") into self-contained queries, can search again with different wording if the first search is thin, and skips the tool for greetings or "what can you do?". The UI shows "Answered without searching the documents" when that happens.
- **Grounding.** The system prompt restricts answers to the retrieved passages, requires a `[p. N]` cite on every claim, and tells the model to say *"I couldn't find that in the documents"* rather than fall back on outside knowledge. Passages below a similarity floor (`minScore`) are dropped so weak matches don't pass as evidence.
- **Sources.** Every answer lists the passages it used: document, page, section heading, a relevance label, and the passage text. Inline `[p. N]` chips scroll to and highlight the matching card. "Open page N ↗" opens the PDF at that page.
- **No secrets in the client.** `OPENAI_API_KEY` and `UPSTASH_*` are read only in `app/api/chat/route.ts` and `lib/seed.ts`. Nothing is `NEXT_PUBLIC_`. The files the browser imports (`lib/corpus.ts`, `lib/corpus-manifest.json`) contain no keys.

## Project structure

```
app/
  api/chat/route.ts     # streamText + searchDocs tool, system prompt, abuse guards
  page.tsx              # chat UI: empty state, streaming, tool status, sources
  layout.tsx            # title, description, Open Graph / Twitter metadata
  opengraph-image.tsx   # generated 1200×630 link-preview image
  globals.css           # design tokens (light + dark) and component styles
components/
  Markdown.tsx          # renders answers, turns [p. N] into clickable chips
  Sources.tsx           # source cards
lib/
  corpus.ts             # ← app name, domain, sample questions, topK, minScore, chunk settings
  seed.ts               # PDF → pages → clean → chunk → embed → upsert
  corpus-manifest.json  # written by the seed; powers "What I've read" in the UI
  types.ts
data/                   # ← put your PDFs here
public/docs/            # seed copies the PDFs here so sources can link to pages
```

## Run it locally

Requirements: Node 18.18+, an OpenAI API key, and an [Upstash Vector](https://console.upstash.com/vector) index created with **1536 dimensions** and **COSINE** similarity.

```bash
npm install
cp .env.example .env.local       # Windows PowerShell: copy .env.example .env.local
# edit .env.local → OPENAI_API_KEY, UPSTASH_VECTOR_REST_URL, UPSTASH_VECTOR_REST_TOKEN
# (+ OPENAI_BASE_URL if your key is issued through a gateway such as Vocareum)

npm run seed:dry                 # optional: chunk only, no API calls → inspect .seed-preview.json
npm run seed                     # chunk + embed + upsert (prints chunk stats)
npm run dev                      # http://localhost:3000
```

If you change chunk settings or remove a PDF, run `npm run seed:reset` so stale chunks are wiped first.

## Deploy to Vercel

1. Push this repo to GitHub. `.env.local` is git-ignored, so keys never leave your machine.
2. On [vercel.com/new](https://vercel.com/new), import the repo. The framework is detected as Next.js automatically.
3. Before clicking **Deploy**, open **Environment Variables** and add `OPENAI_API_KEY`, `UPSTASH_VECTOR_REST_URL`, `UPSTASH_VECTOR_REST_TOKEN` (and `OPENAI_BASE_URL` if you use one) for Production, Preview, and Development.
4. Deploy, then open the URL in an incognito window and ask a few questions.

You don't need to seed again for production. The deployed app queries the same Upstash index you seeded locally.

## Corpus and chunking decisions

| Decision | Choice | Why |
|---|---|---|
| Corpus | 4 Philippine FDA/DOH documents, **55 pages**: AO 2014-0030 (labeling of prepackaged food, 20 pp), AO 2014-0030-A (labeling amendment, 5 pp), AO 153 s. 2004 (Good Manufacturing Practice, 25 pp), and the FDA Citizen's Charter page on LTO initial application for food manufacturers (5 pp) | One real user (a home baker going legit) with real questions: what goes on the label, what the kitchen needs, how to get licensed. Philippine government works aren't copyrighted (RA 8293 §176), so the PDFs can be served publicly. I bake, so I can tell when an answer doesn't make practical sense, and the page citations let me check the legal wording. |
| Text extraction | **OCR.** All 4 PDFs turned out to be scans with no text layer; the first seed produced 0 characters. I ran Tesseract at 300 dpi and overlaid an invisible text layer on the original scans (`qpdf --overlay`), so the served PDFs look the same but are searchable and extractable. | Without this the corpus is empty. OCR artifacts remain (e.g. "Ill." for "III."), which is one reason for the similarity floor. |
| Page extraction | Each page rendered separately | The workshop starter split on `\f`, which `pdf-parse` never emits, so every chunk was labeled page 1. Accurate page numbers matter because citations are the product. |
| Cleaning | Letterhead lines ("Republic of the Philippines / Department of Health / Office of the Secretary…"), running headers/footers, and page numbers are removed; hyphenated line breaks are rejoined | The letterhead repeats at the top of every order and was showing up as the "section" of opening chunks. |
| Headings | Custom heading detector for administrative orders: a numbered line counts as a heading only if what follows the number is short and Title Case / ALL CAPS | These orders number *everything*. The first version treated every clause ("1.4.2 Approve/reject product manufactured or…") as a heading, producing 148 "sections" and a median chunk of 407 chars. After the fix: 81 sections that match the documents' real structure ("9. Food Allergen Information", "Pest Control"), and a median of 676 chars. |
| Chunk size / overlap | **1000 chars (~250 tokens) / 150 chars**, sentence-aligned | A labeling rule or GMP clause is usually 1–3 short paragraphs. 1000 chars keeps one rule, plus its conditions and exceptions, in one chunk. Overlap keeps an "unless…" sentence with the rule it modifies. |
| Boundaries | Chunks never cross a page or a detected section heading | Every citation points to one page, and "Allergen" rules don't bleed into "Storage" rules. |
| Metadata | `title`, `source`, `page`, `section`, `chunk`, `text` | `title` + `page` for citations, `section` shown on the source card, `source` for the "Open page N" deep link. |
| Embedded text | `Document: … / Section: … / <chunk>` | Clauses often don't repeat their topic ("It shall be declared in bold type…"); prepending the section heading ("9. Food Allergen Information") helps them match the question. |
| topK / minScore | **6 / 0.70** | Tuned from measured scores; see the tuning log. |

Result: **181 chunks** (min 83 / median 676 / p95 988 / max 1000 chars).

## Tuning log (Phase 5)

Tested 14 questions locally (labels, allergens, LTO, fees, GMP, language, exemptions, definitions, follow-ups, small talk, out-of-scope). What I found and changed:

| # | Problem observed | Change | Result |
|---|---|---|---|
| 1 | "What must be on my cookie label?" listed 7 of the required items, with citations only at the end | Prompt: cite every bullet or drop it; do a second, list-specific search for "what are all the requirements" questions; topK 5 → 6 | 8 items, each cited. Still misses expiry date / storage (list spans pp. 5–9); see limitations |
| 2 | "How much is the LTO fee?" answered "not found" **without searching**, even though the fee table was indexed | Prompt tweaks didn't fix it (gpt-4o-mini ignores "when to search" rules). Added a **router** in `route.ts`: step 1 requires a `searchDocs` call unless the message is small talk; later steps are the model's choice | Now searches and answers from the fee table |
| 3 | "What about for bread sold unpackaged?" stretched *prepackaged* label rules to loose bread and cited "p. 5-8" | Prompt: documents cover prepackaged food; for unpackaged items report scope/exemptions only; no page ranges | Improved but not fully fixed; kept as a known weakness |
| 4 | Out-of-scope questions (BIR permits) got "not found" plus "typically you need…" outside advice | Prompt: no general knowledge, may only name the agency | gpt-4o-mini still adds a sentence sometimes |
| 5 | Every passage was labelled "Strong match"; `minScore` 0.35 filtered nothing | Measured scores: on-topic 0.75–0.88, off-topic ≤ 0.69. Set `minScore` 0.70; relabelled Strong ≥ 0.83, Good ≥ 0.77 | Off-topic searches now return nothing, so the bot says "not found" |
| 6 | Citation named the wrong document (IgE definition came from AO 153, cited as AO 2014-0030) | Prompt: cite the document the passage came from | Fixed in retest |

## Demo questions

**Good answers**

1. *Do I have to declare allergens like eggs, milk or nuts?* Correct list of the 8 allergen groups plus the "directly below the ingredients" placement rule [AO 2014-0030, p. 9].
2. *What rules apply to the kitchen and equipment if I scale up production?* Grounded GMP summary (non-toxic, corrosion-resistant surfaces, 1 m spacing, calibrated cold storage), each point cited to AO 153.
3. *What do I need to apply for an FDA License to Operate?* Full checklist from the Citizen's Charter, with DTI/SEC variants and fee rows.
4. *Can I label my cookies only in Filipino?* "Yes: English, Filipino, or both" [AO 2014-0030, p. 12].
5. *What's the penalty for violating labeling rules?* Misbranding under RA 9711, with the 12-month transition rule.
6. *Hi! What can you help me with?* Answers without searching (tool correctly skipped).

**Weak or interesting answers**

7. *How much is the LTO fee for a small manufacturer?* Searches and cites p. 1, but answers "Php 400", which is the **iodized salt** "small manufacturer" row. Food manufacturers are charged by capitalization (Php 1,000 for ₱250K and below). OCR flattened the fee table, so the row labels lost their headings.
8. *What about for bread sold unpackaged?* (follow-up) Applies prepackaged label rules to loose bread instead of pointing to the "not prepackaged / immediate consumption" exemption on p. 14.
9. *Do I need a BIR permit to sell cakes?* Correctly says it's not in the documents, but sometimes adds general advice anyway.

## Stretch features

- Search router: the first step requires a `searchDocs` call unless the message is small talk; after that, the model can search up to 2 more times and rewrites follow-up questions into standalone queries
- Live tool status in the chat ("Searching the documents for '…'")
- Clickable inline `[p. N]` citations that highlight the matching source card
- Deep links into the PDF page (`/docs/file.pdf#page=N`)
- Relevance labels and a similarity floor, so answers are honest about weak matches
- `seed:dry` preview and chunk-length statistics for checking chunking before spending on embeddings
- Generated Open Graph image, dark mode, mobile layout
- Abuse guards on the public endpoint: input length cap, history window, `maxTokens`

## Known limitations

- Scanned PDFs, where pages are images, produce no text. The seed prints a warning for pages with no text.
- Tables are flattened into plain text, so questions about table cells can come back garbled (see demo question 7).
- The course's Vocareum OpenAI key may be limited to the course period. If it expires, the live app stops answering until a new key is set in Vercel.
- There's no per-IP rate limit. Set a monthly spend limit on your OpenAI key.
