/**
 * Chat Route Handler — RAG implemented as a tool call.
 *
 * The model sees one tool, `searchDocs`. It decides per turn whether to call
 * it: substantive questions → search (possibly several times with different
 * phrasings); greetings, thanks, or "what can you do?" → answer directly.
 *
 * Secrets (OPENAI_API_KEY, UPSTASH_*) are only read here, on the server.
 */
import { openai } from '@/lib/openai';
import { streamText, tool, embed, convertToCoreMessages, createDataStreamResponse, type Message } from 'ai';
import { Index } from '@upstash/vector';
import { z } from 'zod';
import { corpus, retrieval } from '@/lib/corpus';
import manifest from '@/lib/manifest';
import type { ChunkMeta } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 30;

// Created lazily so `next build` works without secrets present.
let _index: Index<ChunkMeta> | null = null;
const getIndex = () => (_index ??= new Index<ChunkMeta>());

// Basic abuse guards for a public demo that spends your API credits.
const MAX_HISTORY = 12; // messages sent to the model
const MAX_INPUT_CHARS = 2000; // per user message

const docList = manifest.documents.map((d) => `- "${d.title}" (${d.pages} pages)`).join('\n');

const SYSTEM_PROMPT = `You are ${corpus.appName}, a research assistant that answers questions about ${corpus.domain} for ${corpus.audience}.

The knowledge base contains:
${docList || '- (no documents indexed yet)'}

How to work:
1. For any substantive question, call the searchDocs tool BEFORE answering. Do not answer from memory — the documents are the source of truth, even if you think you know the answer.
2. If the first search comes back thin, search again with different wording (synonyms, the formal term, a narrower sub-question). For "what are all the requirements / what must be included" questions, always do a second search for the specific list (e.g. "mandatory label information list") so you don't miss items. Use at most 3 searches per question.
3. Do NOT search for greetings, thanks, small talk, or questions about what you can do — answer those briefly and suggest a question the documents can answer.
4. Answer ONLY with facts found in the search results. In lists, put a citation on EVERY bullet, not just the last one — if you cannot cite a bullet, leave it out. Cite inline as [Short name, p. N], where Short name is the part of the document title before "·" (e.g. [AO 2014-0030, p. 6]) and N is the single page number of the passage you used. Never cite page ranges like "p. 5-8", and cite the document the passage actually came from.
5. If the results do not contain the answer, say plainly: "I couldn't find that in the documents." Then mention the closest related thing you did find (with its citation), if any. Never fill gaps with outside knowledge — not even "typically…" statements. You may name the agency that would know (e.g. BIR, DTI, the LGU), but do not describe its requirements.
6. Only skip the search when the question is CLEARLY unrelated to FDA food rules (e.g. ${corpus.outOfScope.join(', ')}). Anything about labels, licensing, fees, hygiene, premises, penalties or definitions: search first. When in doubt, search.
7. These documents regulate PREPACKAGED food and food manufacturing. If the user asks about unpackaged, loose, made-to-order or "for immediate consumption" items, search the scope and exemptions sections and report exactly what they say; do not extend prepackaged-label rules to unpackaged goods on your own.
8. Be concise: lead with the direct answer, then supporting detail. Use short bullet lists for steps or multiple items. Quote exact wording when precision matters (definitions, numbers, deadlines).
9. Regulations have conditions and exemptions. When a passage says "except", "unless", or "shall not apply", include that — and name the order/section (e.g. "AO 2014-0030, Sec. V") when the passage shows it.
10. You explain the documents; you are not a lawyer. For "am I allowed / do I need…" questions, say what the text requires and suggest confirming with FDA for their specific case. Only quote fees, processing times, or form numbers that appear in the results. If the user's category doesn't match the table exactly (e.g. "small manufacturer" vs. fees by capitalization), explain how the table is organised and show the relevant rows.`;

const tools = {
    searchDocs: tool({
      description:
        `Semantic search over ${corpus.domain}. Call this whenever the user asks about anything the documents might cover ` +
        `(${corpus.topics.join(', ')}), including follow-ups that refer to earlier answers. ` +
        `Returns the most relevant passages with document title, page number, section heading, and a relevance score (0–1). ` +
        `Write the query as a focused, self-contained search phrase — resolve pronouns like "it" or "that" using the conversation.`,
      parameters: z.object({
        query: z.string().describe('A self-contained search phrase, e.g. "refund processing time for annual plans"'),
      }),
      execute: async ({ query }) => {
        try {
          const { embedding } = await embed({
            model: openai.embedding('text-embedding-3-small'),
            value: query,
          });
          const hits = await getIndex().query({
            vector: embedding,
            topK: retrieval.topK,
            includeMetadata: true,
          });
          const results = hits
            .filter((h) => h.metadata && h.score >= retrieval.minScore)
            .map((h) => ({
              id: String(h.id),
              title: h.metadata!.title,
              source: h.metadata!.source,
              page: h.metadata!.page,
              section: h.metadata!.section,
              score: Number(h.score.toFixed(3)),
              text: h.metadata!.text,
            }));
          return {
            query,
            results,
            note:
              results.length === 0
                ? 'No passages were relevant enough. Tell the user the documents do not seem to cover this. Do not add general knowledge.'
                : undefined,
          };
        } catch (err) {
          // Log the real cause server-side (visible in the terminal / Vercel logs)
          // and let the model tell the user search is unavailable instead of crashing.
          console.error('[searchDocs] failed:', err);
          return {
            query,
            results: [],
            note: 'The document search is temporarily unavailable. Apologise briefly, say you cannot look this up right now, and do not answer from memory.',
          };
        }
      },
    }),
};

export async function POST(req: Request) {
  let messages: Message[];
  try {
    ({ messages } = await req.json());
  } catch {
    return new Response('Bad request', { status: 400 });
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    return new Response('No messages', { status: 400 });
  }
  const last = messages[messages.length - 1];
  if (typeof last?.content === 'string' && last.content.length > MAX_INPUT_CHARS) {
    return new Response(`Please keep questions under ${MAX_INPUT_CHARS} characters.`, { status: 413 });
  }

  const history = convertToCoreMessages(messages.slice(-MAX_HISTORY));
  const lastText = typeof last?.content === 'string' ? last.content : '';
  // Router: gpt-4o-mini sometimes skips the search and answers "not found" from
  // memory. So step 1 REQUIRES a searchDocs call for anything that isn't small
  // talk; the model still writes the query and decides on follow-up searches.
  const mustSearch = !isSmallTalk(lastText);

  const common = {
    model: openai('gpt-4o-mini'),
    system: SYSTEM_PROMPT,
    temperature: 0.2,
    maxTokens: 900,
    tools,
  } as const;

  return createDataStreamResponse({
    execute: async (dataStream) => {
      if (!mustSearch) {
        // Model decides freely (usually answers without searching).
        streamText({ ...common, messages: history, maxSteps: 4 }).mergeIntoDataStream(dataStream);
        return;
      }
      // Step 1: forced search.
      const first = streamText({ ...common, messages: history, toolChoice: 'required', maxSteps: 1 });
      first.mergeIntoDataStream(dataStream, { experimental_sendFinish: false });
      const { messages: firstMessages } = await first.response;
      // Steps 2+: model may search again (max 2 more) or answer.
      streamText({ ...common, messages: [...history, ...firstMessages], maxSteps: 3 }).mergeIntoDataStream(dataStream, {
        experimental_sendStart: false,
      });
    },
    onError: (err) => {
      console.error('[chat] error:', err);
      // Show the real reason while developing locally; keep it generic in production.
      if (process.env.NODE_ENV !== 'production') {
        return `${err instanceof Error ? err.message : String(err)}`;
      }
      return 'Something went wrong while answering. Please try again.';
    },
  });
}

/** Greetings, thanks and "what can you do?" don't need a document search. */
function isSmallTalk(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return true;
  if (t.length > 80) return false;
  return /^(hi|hello|hey|yo|good (morning|afternoon|evening)|thanks|thank you|salamat|ok(ay)?|cool|great|nice|bye)\b|what can you (do|help)|who are you|how do(es)? (this|you) work|what do you know/.test(t);
}
