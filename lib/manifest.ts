import raw from './corpus-manifest.json';

/** Summary of what's indexed, written by `npm run seed`. Safe to ship to the client. */
export type Manifest = {
  generatedAt: string | null;
  chunkSize: number;
  chunkOverlap: number;
  totalChunks: number;
  totalPages: number;
  documents: { source: string; title: string; pages: number; chunks: number }[];
};

const manifest = raw as Manifest;
export default manifest;
