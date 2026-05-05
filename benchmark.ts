import { createClient } from '@supabase/supabase-js';
import { loadAdminPlanLimitState } from './src/lib/server/au-limits';

async function run() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) {
    console.log("No Supabase URL/Key, can't benchmark live DB");
    return;
  }
  const supabase = createClient(supabaseUrl, supabaseKey);
  const start = performance.now();
  await loadAdminPlanLimitState(supabase);
  const end = performance.now();
  console.log(`Execution time: ${(end - start).toFixed(2)}ms`);
}
run();
