
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://dhmukdeljiwvvwjdcxgn.supabase.co';
const supabaseServiceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRobXVrZGVsaml3dnZ3amRjeGduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTIwNjAyOCwiZXhwIjoyMDgwNzgyMDI4fQ.3lrr0S4UH-9mccuIZAxn1TH82d-SezY19ny8OTaiS2o';

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
  console.log("Forcing schema reload via RPC...");
  // We can't use 'NOTIFY' directly with supabase-js easily, but we can call an RPC that does it.
  // The admin-handler uses `reload_schema_cache`. Let's try to call it directly if it exists.
  
  const { error } = await supabase.rpc('reload_schema_cache');
  
  if (error) {
    console.error("RPC failed:", error);
    // If RPC doesn't exist, we might need to use a raw query if we had a driver, but we don't here.
    // However, we can try to create the RPC first? 
    // Wait, the admin-handler tries to use `reload_schema_cache`.
    // Let's assume it exists or we need to create it.
    
    if (error.code === '42883') { // function does not exist
        console.log("Function reload_schema_cache does not exist. Creating it requires SQL access.");
        // We can't run raw SQL with supabase-js.
        // But we can try to use the `admin-handler` itself if it was working... but it's 500ing.
        // Catch-22.
        // Wait, I can't use Deno, but I can use `postgres` in Node if I install it?
        // Or I can use the `apply_migration` script pattern if I have one?
        // Let's assume I can't easily run raw SQL from here without a connection string and pg driver.
        // But wait, the previous turn I used `cleanup_au_users.cjs` which just used supabase-js.
        // And I saw `admin-handler` code using `getServiceClient`.
        
        // Strategy: Use the `admin-handler` itself? No, it's broken.
        // Strategy: Use the dashboard? I am the AI.
        // Strategy: Check if there's a "run-sql" function I can call?
        // There was a `run-sql` function in the search results!
        // `c:\Users\cruzan\Documents\Datacube-Au\backend\supabase\functions\run-sql\index.ts`
        
        console.log("Attempting to use run-sql function...");
        const res = await fetch(`${supabaseUrl}/functions/v1/run-sql`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${supabaseServiceKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                query: "NOTIFY pgrst, 'reload schema';"
            })
        });
        
        if (res.ok) {
            console.log("SQL executed via run-sql function.");
        } else {
            console.log("run-sql failed:", await res.text());
        }
    }
  } else {
    console.log("Schema reload signal sent successfully via RPC.");
  }
}

run();
