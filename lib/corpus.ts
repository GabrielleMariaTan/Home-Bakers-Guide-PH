/**
 * Everything that makes this bot about *your* documents lives here.
 *
 * This file is imported by BOTH the server (route handler, seed script) and
 * the client (page UI), so it must never contain secrets.
 */
export const corpus = {
  /** Short product name shown in the header and browser tab. */
  appName: "Home Baker's Guide PH",
  /** One-line pitch shown under the title and in link previews. */
  tagline:
    'For home-based bakers who want to start selling or scale up legally: ask about Philippine FDA labeling, licensing and food-safety rules, with every answer cited to the exact page.',
  /** What the documents are, in plain words. Used in the system prompt and tool description. */
  domain: 'Philippine FDA regulations for small food businesses (labeling of prepackaged food, Good Manufacturing Practice, and License to Operate requirements)',
  /** Who the bot is for. Used in the system prompt. */
  audience:
    'small, home-based bakers in the Philippines who want to start selling or grow into a registered food business under FDA rules. They are not lawyers: explain requirements in plain language, relate them to baked goods when the text allows, and when a question is about growing the business, point out which requirements matter at which stage',
  /** Topics the corpus covers. Steers the tool description so the model knows when to search. */
  topics: [
    'what must appear on a food label (name, ingredients, net content, allergens, expiry/best-before, nutrition facts, manufacturer details)',
    'label language, font size, and exemptions',
    'hygiene, sanitation, premises, equipment, and personnel rules under Good Manufacturing Practice',
    'License to Operate (LTO) application requirements and documents',
    'definitions of regulatory terms',
  ],
  /** Things the corpus clearly does NOT cover, so the bot declines gracefully. */
  outOfScope: [
    'recipes and baking technique',
    'BIR/tax registration, DTI business-name registration, or barangay/mayor’s permits',
    'rules issued after these documents',
  ],
  /** Starter questions shown in the empty state. Pick ones that show the bot at its best. */
  sampleQuestions: [
    'What information must be on the label of my packaged cookies?',
    'Do I have to declare allergens like eggs, milk or nuts?',
    'What do I need to apply for an FDA License to Operate?',
    'What rules apply to the kitchen and equipment if I scale up production?',
  ],
  /** Short brand line for the sidebar. */
  brandLine: 'FDA rules, explained for home bakers',
  /** Hero headline on the empty state (Frost Bakery-style serif). */
  heroTitle: 'Bake it. Label it. Sell it legally.',
  /** The three-step path shown as cards; each card offers starter questions. */
  journey: [
    {
      step: '01',
      title: 'Label it',
      source: 'AO 2014-0030',
      blurb: 'What your cookie bag or cake box must say: name, ingredients, allergens, dates.',
      questions: ['What information must be on the label of my packaged cookies?', 'Do I have to declare allergens like eggs, milk or nuts?'],
    },
    {
      step: '02',
      title: 'Bake it clean',
      source: 'AO 153 s. 2004 (GMP)',
      blurb: 'Kitchen, equipment and hygiene rules once you move beyond a home oven.',
      questions: ['What rules apply to the kitchen and equipment if I scale up production?', 'What hygiene rules apply to people handling the food?'],
    },
    {
      step: '03',
      title: 'Get licensed',
      source: 'FDA Citizen’s Charter',
      blurb: 'Documents, fees and steps for an FDA License to Operate.',
      questions: ['What do I need to apply for an FDA License to Operate?', 'How long does the LTO application take?'],
    },
  ],
  /** Topics in the scrolling ticker; clicking one asks about it. */
  ticker: ['Mandatory label info', 'Food allergens', 'Expiry dates', 'Label language', 'Lot codes', 'Nutrition facts', 'Kitchen & equipment', 'Pest control', 'Food handler hygiene', 'License to Operate', 'LTO fees', 'Labeling exemptions', 'Penalties'],
  /** Brand color (hex) for browser theme and link preview image. CSS colors live in app/globals.css. */
  accent: '#b85c38',
  /** When the documents were last checked against fda.gov.ph (shown in the empty state). */
  asOf: 'September 2026',
  /** Input placeholder. */
  placeholder: 'Ask about labels, allergens, GMP or the LTO…',
  /** Short disclaimer shown under the input box. */
  disclaimer:
    'Information only, not legal advice. Answers come only from the indexed FDA documents and may be outdated — check the cited page and fda.gov.ph.',
  /**
   * If true, the PDFs in public/docs/ are served and every source card links
   * straight to its page (…/file.pdf#page=N). Philippine government works are
   * not copyrighted (RA 8293 §176), so these can be redistributed.
   */
  linkToPdfPages: true,
  /**
   * Human titles per file. The PDFs' built-in titles are junk ("DOH Scanned
   * Document", "phi174223.pdf"), and these titles are shown in citations.
   */
  documentTitles: {
    'AO-2014-0030-Food-Labeling.pdf': 'AO 2014-0030 · Labeling of Prepackaged Food',
    'AO-2014-0030-A-Labeling-Amendment.pdf': 'AO 2014-0030-A · Labeling Amendment (Sweetened Beverages)',
    'AO-153-s2004-Good-Manufacturing-Practice.pdf': 'AO 153 s. 2004 · Good Manufacturing Practice (GMP)',
    'FDA-LTO-Initial-Application-Food-Manufacturers.pdf': 'FDA Citizen’s Charter · LTO Initial Application (Food Manufacturers)',
  } as Record<string, string>,
  /** Lines stripped before chunking (letterheads, signature blocks, scan artefacts). */
  dropLinePatterns: [
    /^republic of the philippines$/i,
    /^department of health$/i,
    /^office of the secretary$/i,
    /san lazaro/i,
    /^(fda[\s,.]*)?food\s+and\s+drug\s+administration$/i,
    /^philippines$/i,
    /^fda[\s,.]*$/i,
  ] as RegExp[],
} as const;

/** Retrieval knobs. Tuned in Phase 5 — see README "Tuning log". */
export const retrieval = {
  /** How many chunks one tool call returns to the model. */
  topK: 6,
  /**
   * Cosine-similarity floor (Upstash returns 0–1, higher = closer).
   * Anything below this is treated as "not relevant" and dropped so the model
   * can honestly say the documents don't cover it. Calibrated in testing:
   * off-topic questions (e.g. BIR permits) topped out at 0.69, on-topic
   * passages scored 0.75–0.88. The starter-style 0.35 filtered nothing.
   */
  minScore: 0.7,
} as const;

/** Chunking knobs used by lib/seed.ts. */
export const chunking = {
  /** Target characters per chunk (~4 chars per token → ~250 tokens). */
  chunkSize: 1000,
  /** Characters repeated between neighbouring chunks on the same page. */
  chunkOverlap: 150,
  /** Chunks shorter than this (headers/footers, page numbers) are dropped. */
  minChunkChars: 80,
} as const;
