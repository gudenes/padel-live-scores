/** Run with root .env.local; read-only unless --apply. */
import { createClient } from '@supabase/supabase-js';
import { runWorldCupReconciler } from '../src/workers/world-cup-reconciler.js';
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, (process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY)!);
console.log(await runWorldCupReconciler({supabase: db, dryRun: !process.argv.includes('--apply')}));
