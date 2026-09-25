// Imported first by lib/seed.ts so env vars exist before other modules load.
// (Next.js loads .env.local itself; this is only for the standalone seed script.)
import { config } from 'dotenv';
config({ path: '.env.local' });
config();
