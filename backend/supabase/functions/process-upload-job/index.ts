/// <reference path="../deno.d.ts" />
// @ts-ignore - Deno Edge Function (HTTP imports are valid in Deno runtime)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
// @ts-ignore - Deno Edge Function (HTTP imports are valid in Deno runtime)
import * as pdfjsLib from "https://esm.sh/pdfjs-dist@4.0.379/legacy/build/pdf.mjs";
// @ts-ignore - Deno Edge Function (HTTP imports are valid in Deno runtime)
import mammoth from "https://esm.sh/mammoth@1.7.1";
// @ts-ignore - Deno Edge Function (HTTP imports are valid in Deno runtime)
import JSZip from "https://esm.sh/jszip@3.10.1";
import { requireAnyAuth, getCorsHeaders } from "../_shared/au.ts";
import { getApiKey } from "../_shared/getApiKey.ts";

/* ------------------------- Constants ------------------------- */

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

/* ------------------------- Handler ------------------------- */

Deno.serve(async (req: Request) => {
  const requestId = crypto.randomUUID();
  const corsHeaders = getCorsHeaders(req);

  // 1. Handle CORS preflight IMMEDIATELY
  if (req.method === "OPTIONS") {
    return new Response(null, { 
      status: 204,
      headers: corsHeaders 
    });
  }

  let currentJobId: string | null = null;
  let supabaseClient: any = null;

  try {
    const body = await req.json().catch(() => ({}));
    const { userId, ownershipFilter, supabaseAdmin: supabase, error: authError } = await requireAnyAuth(req, body);
    supabaseClient = supabase;

    if (authError) {
      return new Response(JSON.stringify({ 
        error: authError,
        details: "Authentication failed",
        requestId
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 401,
      });
    }

    const jobId = body.jobId || body.file_id || body.job_id;
    currentJobId = jobId;

    if (!jobId || !validateUUID(jobId)) {
      return new Response(JSON.stringify({ 
        error: "Invalid jobId format",
        details: "A valid UUID jobId must be provided",
        requestId 
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }

    console.log(`[process-upload-job] Processing job: ${jobId}`, { 
      userId, 
      ownershipFilter 
    });

    // 2. Fetch job
    const { data: job, error: jobErr } = await supabase
      .from("au_upload_jobs")
      .select("*")
      .eq("id", jobId)
      .match(ownershipFilter)
      .single();

    if (jobErr || !job) {
      console.error(`[process-upload-job] Job not found or unauthorized`, { jobId, error: jobErr });
      throw new Error(jobErr?.message || "Job not found or unauthorized");
    }

    if (job.status === "done") {
      return new Response(JSON.stringify({ 
        ok: true, 
        alreadyDone: true,
        requestId
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 3. Update job status to processing
    await supabase
      .from("au_upload_jobs")
      .update({ status: "processing", progress: 10 })
      .eq("id", jobId);

    // 4. Fetch document
    const { data: doc, error: docErr } = await supabase
      .from("au_documents")
      .select("*")
      .eq("id", job.document_id)
      .match(ownershipFilter)
      .single();

    if (docErr || !doc) {
      throw new Error(docErr?.message || "Document not found or unauthorized");
    }

    // 5. Download file
    const bucket = job.bucket || Deno.env.get("SUPABASE_BUCKET") || "documents";
    const storagePath = doc.file_path || job.object_path;

    console.log(`[process-upload-job] Downloading from ${bucket}/${storagePath}`);
    const { data: file, error: fileErr } = await supabase.storage
      .from(bucket)
      .download(storagePath);

    if (fileErr || !file) {
      throw new Error(fileErr?.message || "File download failed");
    }

    // 6. Extract text
    await supabase
      .from("au_upload_jobs")
      .update({ progress: 30 })
      .eq("id", jobId);

    const name = job.file_name.toLowerCase();
    let text = "";
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

    if (!text.trim()) {
      throw new Error("Document is empty after text extraction");
    }

    // 7. Split and Insert Chunks
    const chunks = splitText(text.trim());
    console.log(`[process-upload-job] Split into ${chunks.length} chunks`);

    await supabase
      .from("au_upload_jobs")
      .update({ progress: 50 })
      .eq("id", jobId);

    // Clean up old chunks for this document (idempotency)
    await supabase
      .from("au_document_chunks")
      .delete()
      .eq("document_id", job.document_id)
      .match(ownershipFilter);

    const { data: inserted, error: insertErr } = await supabase
      .from("au_document_chunks")
      .insert(
        chunks.map((t, i) => ({
          document_id: job.document_id,
          ...ownershipFilter,
          chunk_index: i,
          text: t,
        }))
      )
      .select("id, text");

    if (insertErr || !inserted) {
      throw new Error(insertErr?.message || "Failed to insert chunks");
    }

    // 8. Generate Embeddings
    await supabase
      .from("au_upload_jobs")
      .update({ progress: 70 })
      .eq("id", jobId);

    let openaiKey;
    try {
      openaiKey = await getApiKey(supabase, "openai");
    } catch (e) {
      console.warn("[process-upload-job] OpenAI key not found, trying OpenRouter");
      openaiKey = await getApiKey(supabase, "openrouter");
    }

    const embeddings: any[] = [];
    for (const row of inserted) {
      const res = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${openaiKey}`,
        },
        body: JSON.stringify({
          model: "text-embedding-ada-002",
          input: row.text.replace(/\n/g, ' '),
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        console.error(`[process-upload-job] Embedding error: ${errText}`);
        throw new Error(`Embedding failed: ${res.status} ${errText}`);
      }

      const json = await res.json();
      embeddings.push({
        chunk_id: row.id,
        embedding: json.data[0].embedding,
        model_name: "text-embedding-ada-002",
      });
    }

    // 9. Store Embeddings
    const { error: embeddingsErr } = await supabase
      .from("au_document_embeddings")
      .insert(embeddings);

    if (embeddingsErr) {
      throw new Error(`Failed to store embeddings: ${embeddingsErr.message}`);
    }

    // 10. Finalize
    await supabase
      .from("au_documents")
      .update({ status: "completed" })
      .eq("id", job.document_id)
      .match(ownershipFilter);

    await supabase
      .from("au_upload_jobs")
      .update({ status: "done", progress: 100 })
      .eq("id", jobId);

    console.log(`[process-upload-job] Success for job: ${jobId}`);

    return new Response(JSON.stringify({ 
      ok: true,
      requestId
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error: any) {
    console.error(`[process-upload-job] Fatal error [${requestId}]:`, error);
    
    // Attempt to mark job as failed if we have the ID
    if (currentJobId && supabaseClient) {
      try {
        await supabaseClient
          .from("au_upload_jobs")
          .update({ 
            status: "failed", 
            error_message: error.message || String(error),
            progress: 100 
          })
          .eq("id", currentJobId);
      } catch (updateErr) {
        console.error(`[process-upload-job] Failed to update job status to failed [${requestId}]:`, updateErr);
      }
    }

    return new Response(
      JSON.stringify({ 
        error: error.message || "Internal server error",
        details: error.stack || String(error),
        requestId
      }),
      {
        status: error.status || 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
