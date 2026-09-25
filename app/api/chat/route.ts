/**
 * Chat Route Handler — RAG implemented as a tool call.
 *
 * The model sees one tool, `searchDocs`. It decides per turn whether to call
 * it: substantive questions → search (possibly several times with different
 * phrasings); greetings, thanks, or "what can you do?" → answer directly.
 *
 * Secrets (OPENAI_API_KEY, UPSTASH_*) are only read here, on the server.
 */
import { openai } from '@ai-sdk/openai';
import { streamText, tool, embed, type Message } from 'ai';
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

const docList = manifest.documents
  .map((d) => `- "${d.title}" (${d.pages} pages)`)
  .join('\n');

const SYSTEM_PROMPT = `You are ${corpus.appName}, a research assistant that answers questions about ${corpus.domain} for ${corpus.audience}.

The knowledge base contains:
${docList || '- (no documents indexed yet)'}

How to work:
1. For any substantive question, call the searchDocs tool BEFORE answering. Do not answer from memory — the documents are the source of truth, even if you think you know the answer.
2. If the first search comes back thin, search again with different wording (synonyms, the formal term, a narrower sub-question). Use at most 3 searches per question.
3. Do NOT search for greetings, thanks, small talk, or questions about what you can do — answer those briefly and suggest a question the documents can answer.
4. Answer ONLY with facts found in the search results. Cite every factual claim inline as [Short name, p. N], where Short name is the part of the document title before "·" (e.g. [AO 2014-0030, p. 6]) and N is the page number from the results.
5. If the results do not contain the answer, say plainly: "I couldn't find that in the documents." Then mention the closest related thing you did find (with its citation), if any. Never fill gaps with outside knowledge.
6. If the question is outside the scope of the documents (e.g. ${corpus.outOfScope.join(', ')}), say so in one sentence without searching.
7. Be concise: lead with the direct answer, then supporting detail. Use short bullet lists for steps or multiple items. Quote exact wording when precision matters (definitions, numbers, deadlines).
8. Regulations have conditions and exemptions. When a passage says "except", "unless", or "shall not apply", include that — and name the order/section (e.g. "AO 2014-0030, Sec. V") when the passage shows it.
9. You explain the documents; you are not a lawyer. For "am I allowed / do I need…" questions, say what the text requires and suggest confirming with FDA for their specific case. Never invent fees, processing times, or form numbers.`;

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

  const result = streamText({
    model: openai('gpt-4o-mini'),
    system: SYSTEM_PROMPT,
    messages: messages.slice(-MAX_HISTORY),
    temperature: 0.2,
    maxTokens: 900,
    maxSteps: 4, // up to 3 searches + the final answer
    tools: {
      searchDocs: tool({
        description:
          `Semantic search over ${corpus.domain}. Call this whenever the user asks about anything the documents might cover ` +
          `(${corpus.topics.join(', ')}), including follow-ups that refer to earlier answers. ` +
          `Returns the most relevant passages with document title, page number, section heading, and a relevance score (0–1). ` +
          `Write the query as a focused, self-contained search phrase — resolve pronouns like "it" or "that" using the conversation.`,
        parameters: z.object({
          query: z
            .string()
            .describe('A self-contained search phrase, e.g. "refund processing time for annual plans"'),
        }),
        execute: async ({ query }) => {
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
                ? 'No passages were relevant enough. Tell the user the documents do not seem to cover this.'
                : undefined,
          };
        },
      }),
    },
  });

  return result.toDataStreamResponse({
    getErrorMessage: (err) => {
      console.error(err);
      return 'Something went wrong while answering. Please try again.';
    },
  });
}
