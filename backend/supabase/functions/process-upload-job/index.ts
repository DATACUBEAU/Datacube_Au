/// <reference path="../deno.d.ts" />
// @ts-ignore - Deno Edge Function
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
// @ts-ignore - Deno Edge Function
import * as pdfjsLib from "https://esm.sh/pdfjs-dist@4.0.379/legacy/build/pdf.mjs";
// @ts-ignore - Deno Edge Function
import mammoth from "https://esm.sh/mammoth@1.7.1";
// @ts-ignore - Deno Edge Function
import JSZip from "https://esm.sh/jszip@3.10.1";
import { requireAnyAuth, getCorsHeaders, generateEmbedding } from "../_shared/au.ts";

/* ------------------------- Constants ------------------------- */

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMBEDDING_BATCH_SIZE = 5; // Process 5 embeddings at a time
const INSERT_BATCH_SIZE = 50; // Insert 50 chunks at a time
const TIMEOUT_BUFFER_MS = 3000; // Stop 3 seconds before timeout
const FUNCTION_TIMEOUT_MS = 50000; // Assume 50s limit (safe margin for 60s)

/* ------------------------- Helpers ------------------------- */

function splitText(text: string, size = 1500, overlap = 150): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    out.push(text.slice(i, i + size));
    i += size - overlap;
  }
  return out.filter(Boolean);
}

async function extractTextFromPdf(buf: ArrayBuffer): Promise<string> {
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    pages.push(
      (content.items as any[])
        .map((i) => i.str)
        .filter(Boolean)
        .join(" ")
    );
  }
  return pages.join("\n\n");
}

async function extractTextFromDocx(buf: ArrayBuffer): Promise<string> {
  const res = await (mammoth as any).extractRawText({ arrayBuffer: buf });
  return res?.value ?? "";
}

async function extractTextFromPptx(buf: ArrayBuffer): Promise<string> {
  const zip = await JSZip.loadAsync(buf);
  const slides = Object.keys(zip.files)
    .filter((f) => f.startsWith("ppt/slides/slide"))
    .sort();
  const out: string[] = [];
  for (const f of slides) {
    const xml = await zip.files[f].async("string");
    out.push(
      (xml.match(/<a:t>(.*?)<\/a:t>/g) ?? [])
        .map((m: string) => m.replace(/<\/?a:t>/g, ""))
        .join(" ")
    );
  }
  return out.join("\n\n");
}

function validateUUID(id: string): boolean {
  return UUID_REGEX.test(id);
}

// Helper to update progress and check timeout
async function updateProgress(
  supabase: any,
  jobId: string,
  progress: number,
  startTime: number
): Promise<void> {
  const elapsed = Date.now() - startTime;
  if (elapsed > FUNCTION_TIMEOUT_MS - TIMEOUT_BUFFER_MS) {
    throw new Error("Time limit approaching - stopped safely");
  }
  
  await supabase
    .from("au_upload_jobs")
    .update({ progress, updated_at: new Date().toISOString() })
    .eq("id", jobId);
}

/* ------------------------- Handler ------------------------- */

Deno.serve(async (req: Request) => {
  const requestId = crypto.randomUUID();
  const startTime = Date.now();
  const corsHeaders = getCorsHeaders(req);

  // 1. Handle CORS preflight IMMEDIATELY
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  let currentJobId: string | null = null;
  let supabaseClient: any = null;

  try {
    const body = await req.json().catch(() => ({}));
    const { userId, ownershipFilter, supabaseAdmin: supabase, error: authError, isAdmin } = await requireAnyAuth(req, body);
    supabaseClient = supabase;

    if (authError) {
      return new Response(JSON.stringify({ error: authError, details: "Authentication failed", requestId }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 401,
      });
    }

    const jobId = body.jobId || body.file_id || body.job_id;
    currentJobId = jobId;

    if (!jobId || !validateUUID(jobId)) {
      return new Response(JSON.stringify({ error: "Invalid jobId format", requestId }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }

    console.log(`[process-upload-job] Processing job: ${jobId}`);

    // -------------------------------------------------------------------------
    // STEP 1: Fetch Job & Validate
    // -------------------------------------------------------------------------
    let query = supabase.from("au_upload_jobs").select("*").eq("id", jobId);
    if (!isAdmin && ownershipFilter) query = query.match(ownershipFilter);
    const { data: job, error: jobErr } = await query.single();

    if (jobErr || !job) {
      throw new Error(jobErr?.message || "Job not found or unauthorized");
    }

    if (job.status === "done") {
      return new Response(JSON.stringify({ ok: true, alreadyDone: true, requestId }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await updateProgress(supabase, jobId, 10, startTime);

    // -------------------------------------------------------------------------
    // STEP 2: Fetch Document & File
    // -------------------------------------------------------------------------
    let docQuery = supabase.from("au_documents").select("*").eq("id", job.document_id);
    if (!isAdmin && ownershipFilter) docQuery = docQuery.match(ownershipFilter);
    const { data: doc, error: docErr } = await docQuery.single();

    if (docErr || !doc) {
      throw new Error(docErr?.message || "Document not found");
    }

    const bucket = job.bucket || Deno.env.get("SUPABASE_BUCKET") || "documents";
    const storagePath = doc.file_path || job.object_path;

    console.log(`[process-upload-job] Downloading ${bucket}/${storagePath}`);
    const { data: file, error: fileErr } = await supabase.storage.from(bucket).download(storagePath);

    if (fileErr || !file) {
      throw new Error(fileErr?.message || "File download failed");
    }

    await updateProgress(supabase, jobId, 20, startTime);

    // -------------------------------------------------------------------------
    // STEP 3: Extract Text
    // -------------------------------------------------------------------------
    const name = job.file_name.toLowerCase();
    let text = "";
    try {
      if (name.endsWith(".txt") || name.endsWith(".md")) {
        text = await file.text();
      } else if (name.endsWith(".pdf")) {
        text = await extractTextFromPdf(await file.arrayBuffer());
      } else if (name.endsWith(".docx")) {
        text = await extractTextFromDocx(await file.arrayBuffer());
      } else if (name.endsWith(".pptx")) {
        text = await extractTextFromPptx(await file.arrayBuffer());
      } else {
        throw new Error(`Unsupported file type: ${name}`);
      }
    } catch (e: any) {
      throw new Error(`Text extraction failed: ${e.message}`);
    }

    if (!text || text.trim().length === 0) {
      throw new Error("Document is empty after text extraction");
    }

    await updateProgress(supabase, jobId, 40, startTime);

    // -------------------------------------------------------------------------
    // STEP 4: Chunk Text
    // -------------------------------------------------------------------------
    const chunks = splitText(text.trim());
    console.log(`[process-upload-job] Generated ${chunks.length} chunks`);

    if (chunks.length === 0) {
      throw new Error("No text chunks generated");
    }

    await updateProgress(supabase, jobId, 50, startTime);

    // -------------------------------------------------------------------------
    // STEP 5: Clear Old Data (Idempotency)
    // -------------------------------------------------------------------------
    let deleteQuery = supabase.from("au_document_chunks").delete().eq("document_id", job.document_id);
    if (!isAdmin && ownershipFilter) deleteQuery = deleteQuery.match(ownershipFilter);
    await deleteQuery;

    // -------------------------------------------------------------------------
    // STEP 6: Insert Chunks (Batched)
    // -------------------------------------------------------------------------
    const insertedChunks: any[] = [];
    
    for (let i = 0; i < chunks.length; i += INSERT_BATCH_SIZE) {
      const batch = chunks.slice(i, i + INSERT_BATCH_SIZE);
      const payload = batch.map((t, idx) => {
        const row: any = {
          document_id: job.document_id,
          chunk_index: i + idx,
          text: t,
        };
        // Apply ownership
        if (!isAdmin && ownershipFilter) Object.assign(row, ownershipFilter);
        else {
          if (job.user_id) row.user_id = job.user_id;
          if (job.guest_session_id) row.guest_session_id = job.guest_session_id;
        }
        return row;
      });

      const { data: inserted, error: insertErr } = await supabase
        .from("au_document_chunks")
        .insert(payload)
        .select("id, text");

      if (insertErr) throw insertErr;
      if (inserted) insertedChunks.push(...inserted);
      
      // Update progress slightly for large files
      if (i % (INSERT_BATCH_SIZE * 2) === 0) {
        await updateProgress(supabase, jobId, 50 + Math.floor((i / chunks.length) * 10), startTime);
      }
    }

    await updateProgress(supabase, jobId, 60, startTime);

    // -------------------------------------------------------------------------
    // STEP 7: Generate & Insert Embeddings (Batched)
    // -------------------------------------------------------------------------
    if (insertedChunks.length === 0) {
      throw new Error("Chunks were processed but none returned from DB");
    }

    for (let i = 0; i < insertedChunks.length; i += EMBEDDING_BATCH_SIZE) {
      const batch = insertedChunks.slice(i, i + EMBEDDING_BATCH_SIZE);
      const embeddingsToInsert: any[] = [];

      // Parallel embedding generation for this batch
      await Promise.all(batch.map(async (chunk) => {
        try {
          const vector = await generateEmbedding(supabase, chunk.text.replace(/\n/g, ' '));
          embeddingsToInsert.push({
            chunk_id: chunk.id,
            embedding: vector,
            model_name: "text-embedding-ada-002",
          });
        } catch (e: any) {
          console.error(`Embedding failed for chunk ${chunk.id}:`, e);
          // We continue even if one chunk fails, to avoid total job failure
        }
      }));

      if (embeddingsToInsert.length > 0) {
        const { error: embedErr } = await supabase
          .from("au_document_embeddings")
          .insert(embeddingsToInsert);
        
        if (embedErr) throw embedErr;
      }

      // Update progress proportional to completion (60% -> 90%)
      const percentComplete = Math.floor(60 + ((i + batch.length) / insertedChunks.length) * 30);
      await updateProgress(supabase, jobId, percentComplete, startTime);
    }

    // -------------------------------------------------------------------------
    // STEP 8: Finalize
    // -------------------------------------------------------------------------
    await supabase.from("au_documents").update({ status: "completed" }).eq("id", job.document_id);
    await supabase.from("au_upload_jobs").update({ status: "done", progress: 100 }).eq("id", jobId);

    console.log(`[process-upload-job] Job ${jobId} completed successfully`);

    return new Response(JSON.stringify({ ok: true, jobId, requestId }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error: any) {
    console.error(`[process-upload-job] Failed [${requestId}]:`, error);

    if (supabaseClient && currentJobId) {
      // 1. Mark Job Failed
      await supabaseClient.from("au_upload_jobs")
        .update({ 
          status: "failed", 
          error_message: error.message || "Unknown error",
          progress: 100 
        })
        .eq("id", currentJobId);

      // 2. Log Debug Info
      await supabaseClient.from("au_debug_logs").insert({
        component: "process-upload-job",
        message: "Job execution failed",
        details: { 
          jobId: currentJobId, 
          error: error.message, 
          stack: error.stack,
          requestId 
        }
      });
    }

    return new Response(JSON.stringify({ 
      error: error.message || "Internal server error", 
      requestId 
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
