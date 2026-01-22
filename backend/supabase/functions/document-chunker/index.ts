// @ts-ignore: Deno modules
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @ts-ignore: Deno modules
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
// @ts-ignore: Deno modules
import * as pdfjsLib from "https://esm.sh/pdfjs-dist@4.0.379/legacy/build/pdf.mjs";
// @ts-ignore: Deno modules
import mammoth from "https://esm.sh/mammoth@1.7.1";
import { corsHeaders, validateAuth, requireAnyAuth, emitEvent } from "../_shared/au.ts";

// Simple recursive character text splitter
function splitText(text: string, chunkSize = 1500, overlap = 150): string[] {
  if (text.length <= chunkSize) return [text];
  
  const chunks: string[] = [];
  let start = 0;
  
  while (start < text.length) {
    let end = start + chunkSize;
    
    if (end >= text.length) {
      chunks.push(text.slice(start));
      break;
    }
    
    // Try to break at a newline or space
    const lastSpace = text.lastIndexOf(' ', end);
    const lastNewline = text.lastIndexOf('\n', end);
    
    if (lastNewline > start + chunkSize / 2) {
      end = lastNewline;
    } else if (lastSpace > start + chunkSize / 2) {
      end = lastSpace;
    }
    
    chunks.push(text.slice(start, end));
    start = end - overlap;
  }
  
  return chunks;
}

async function extractTextFromPdf(arrayBuffer: ArrayBuffer): Promise<string> {
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
  const pages: string[] = [];
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum += 1) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    const text = (content.items as any[])
      .map((it) => (typeof it?.str === "string" ? it.str : ""))
      .filter(Boolean)
      .join(" ");
    if (text) pages.push(text);
  }
  return pages.join("\n\n");
}

async function extractTextFromDocx(arrayBuffer: ArrayBuffer): Promise<string> {
  const result = await (mammoth as any).extractRawText({ arrayBuffer });
  return typeof result?.value === "string" ? result.value : "";
}

Deno.serve(async (req: Request) => {
  const requestId = crypto.randomUUID();

  if (req.method === "OPTIONS") {
    return new Response(null, { 
      status: 204,
      headers: corsHeaders 
    });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const { documentId } = body;
    const { userId, ownershipFilter, supabaseAdmin } = await requireAnyAuth(req, body);

    if (!documentId) {
      return new Response(JSON.stringify({ 
        error: "Missing required field: documentId",
        details: "A documentId must be provided",
        requestId 
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }

    // Even if RLS is disabled, we prefer to have an owner for tracking.
    const effectiveFilter = ownershipFilter || {};

    // 1. Get Document Info with manual ownership enforcement
    const query = supabaseAdmin
      .from("au_documents")
      .select("* ")
      .eq("id", documentId);
    
    if (Object.keys(effectiveFilter).length > 0) {
      query.match(effectiveFilter);
    }

    const { data: doc, error: docError } = await query.single();

    if (docError || !doc) {
      return new Response(JSON.stringify({ 
        error: "Document not found",
        details: docError?.message || "Document not found or unauthorized",
        requestId 
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 404,
      });
    }

    // 2. Download File
    // Note: 'documents' is the bucket name usually.
    const bucket = Deno.env.get("NEXT_PUBLIC_SUPABASE_BUCKET") || "documents";
    const { data: fileData, error: downloadError } = await supabaseAdmin.storage
      .from(bucket)
      .download(doc.file_path);

    if (downloadError) {
      return new Response(JSON.stringify({ 
        error: "Download failed",
        details: downloadError.message,
        requestId 
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      });
    }

    // 3. Extract Text
    let textContent = "";
    const fileName = String(doc.file_name ?? "").toLowerCase();
    if (fileName.endsWith(".txt") || fileName.endsWith(".md")) {
      textContent = await fileData.text();
    } else if (fileName.endsWith(".pdf")) {
      const buffer = await fileData.arrayBuffer();
      textContent = await extractTextFromPdf(buffer);
    } else if (fileName.endsWith(".docx")) {
      const buffer = await fileData.arrayBuffer();
      textContent = await extractTextFromDocx(buffer);
    } else {
      try {
          textContent = await fileData.text();
      } catch {
        return new Response(JSON.stringify({ 
          error: "Unsupported file type",
          details: "This file type is not supported for extraction",
          requestId 
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        });
      }
    }

    if (!textContent) {
      return new Response(JSON.stringify({ 
        error: "Empty content",
        details: "Document content is empty after extraction",
        requestId 
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }

    // 4. Chunk
    const chunks = splitText(textContent);

    // 5. Save Chunks with manual ownership enforcement
    const deleteQuery = supabaseAdmin
      .from("au_document_chunks")
      .delete()
      .eq("document_id", documentId);
    
    if (Object.keys(effectiveFilter).length > 0) {
      deleteQuery.match(effectiveFilter);
    }
    
    await deleteQuery;

    const chunksData = chunks.map((chunk, index) => ({
      document_id: documentId,
      ...effectiveFilter,
      chunk_index: index,
      text: chunk,
    }));

    const { error: chunksError } = await supabaseAdmin
      .from("au_document_chunks")
      .insert(chunksData);

    if (chunksError) {
      return new Response(JSON.stringify({ 
        error: "Save failed",
        details: chunksError.message,
        requestId 
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      });
    }

    // Update document status
    const updateDocQuery = supabaseAdmin
      .from("au_documents")
      .update({ status: "chunked" })
      .eq("id", documentId);
    
    if (Object.keys(effectiveFilter).length > 0) {
      updateDocQuery.match(effectiveFilter);
    }

    await updateDocQuery;

    // 5. Emit Sync Event
    await emitEvent(supabaseAdmin, {
      event_type: 'vector_indexed',
      entity_id: documentId,
      user_id: userId || 'anonymous',
      metadata: { chunkCount: chunks.length }
    });

    // 6. Trigger Embedding Generator (Background)
    const functionsUrl = Deno.env.get("SUPABASE_URL")?.replace(".co", ".co/functions/v1") ?? "";
    const serviceToken = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    
    // We fire and forget this one to keep chunker response fast
    fetch(`${functionsUrl}/embedding-generator`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${serviceToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ 
        documentId: documentId,
        guestSessionId: body.guestSessionId || userId
      }),
    }).catch(err => console.error("[chunker] Failed to trigger embedding generator:", err));

    return new Response(JSON.stringify({ 
      ok: true,
      chunksCount: chunks.length,
      requestId
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error: any) {
    console.error(`[document-chunker] Error [${requestId}]:`, error);
    return new Response(JSON.stringify({ 
      error: error.message || "Internal server error",
      details: error.stack || String(error),
      requestId
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: error.status || 500,
    });
  }
});
