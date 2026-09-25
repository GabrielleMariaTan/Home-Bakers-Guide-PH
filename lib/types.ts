/** Metadata stored with every vector in Upstash (written by lib/seed.ts). */
export type ChunkMeta = {
  text: string; // the chunk as shown to users
  source: string; // file name, e.g. handbook.pdf
  title: string; // human title of the document
  page: number; // 1-based page number
  section: string; // nearest heading above the chunk ('' if none)
  chunk: number; // index of the chunk within its page
};

/** What the searchDocs tool returns to the model (and the UI renders). */
export type SearchResult = Omit<ChunkMeta, 'chunk'> & { id: string; score: number };
export type SearchOutput = { query: string; results: SearchResult[]; note?: string };
