
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeaders } from "../_shared/au.ts";
import * as jose from "https://deno.land/x/jose@v4.14.4/index.ts";

async function verifyAppToken(req: Request) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return null;
  const token = authHeader.replace("Bearer ", "");
  
  const APP_SECRET = Deno.env.get("APP_SECRET") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!APP_SECRET) throw new Error("Missing APP_SECRET");

  try {
    const { payload } = await jose.jwtVerify(token, new TextEncoder().encode(APP_SECRET));
    return payload.sub as string; // returns au_users.id
  } catch (e) {
    console.error("Token verification failed:", e);
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    // Determine user ID from App Token OR Supabase Auth (Unified Handler)
    // If Authorization header is a valid App Token, use that.
    // If it's a Supabase JWT, verify via getUser.
    
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    let userId: string | null = await verifyAppToken(req);
    
    if (!userId) {
        // Try Supabase Auth
        const supabaseAnon = createClient(
            Deno.env.get("SUPABASE_URL") ?? "",
            Deno.env.get("SUPABASE_ANON_KEY") ?? "",
            { global: { headers: { Authorization: req.headers.get("Authorization")! } } }
        );
        const { data: { user } } = await supabaseAnon.auth.getUser();
        if (user) userId = user.id;
    }

    if (!userId) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Route logic
    const path = url.pathname.split("/").pop(); // e.g. "list", "get"

    if (req.method === "GET") {
        // List Documents
        const { data, error } = await supabaseAdmin
            .from("au_documents")
            .select("*")
            .eq("owner_id", userId)
            .order("created_at", { ascending: false });
        
        if (error) throw error;
        return new Response(JSON.stringify(data), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (req.method === "POST") {
        // Handle actions like "get_text" or "delete" if passed in body, or standard CRUD
        const body = await req.json();
        const { action, documentId } = body;

        if (action === "get_text") {
             const { data, error } = await supabaseAdmin
                .from("au_document_chunks")
                .select("text")
                .eq("owner_id", userId) // Strict enforcement
                .eq("document_id", documentId)
                .order("chunk_index", { ascending: true });
            
            if (error) throw error;
            const text = data.map((c: any) => c.text).join("\n\n");
            return new Response(JSON.stringify({ text }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        
        // Add more actions as needed
    }

    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: corsHeaders });

  } catch (error: any) {
    console.error("Documents API Error:", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
