export async function sha256Hex(input: string): Promise<string> {
  const text = String(input || "");
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((part) => part.toString(16).padStart(2, "0"))
    .join("");
}

function safeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function resolveDocumentVersion(input: {
  supabaseAdmin: any;
  userId: string;
  documentId?: string | null;
  sourceText?: string | null;
  fallbackTexts?: Array<string | null | undefined>;
}): Promise<{ documentId: string | null; versionId: string | null; contentHash: string | null }> {
  const supabaseAdmin = input.supabaseAdmin;
  const userId = safeString(input.userId);
  const documentId = safeString(input.documentId);
  if (!supabaseAdmin || !userId || !documentId) {
    return { documentId: null, versionId: null, contentHash: null };
  }

  const { data: documentRow, error: docError } = await supabaseAdmin
    .from("au_documents")
    .select("id,user_id,content_hash")
    .eq("id", documentId)
    .maybeSingle();
  if (docError || !documentRow) {
    return { documentId: null, versionId: null, contentHash: null };
  }

  const ownerId = safeString((documentRow as any)?.user_id);
  if (!ownerId || ownerId !== userId) {
    return { documentId: null, versionId: null, contentHash: null };
  }

  const explicitText = safeString(input.sourceText);
  const fallbackBlob = Array.isArray(input.fallbackTexts)
    ? input.fallbackTexts
        .map((value) => safeString(value))
        .filter((value) => value.length > 0)
        .join("\n\n")
    : "";
  let contentHash = safeString((documentRow as any)?.content_hash);

  if (!contentHash) {
    const material = explicitText || fallbackBlob;
    if (material) {
      contentHash = await sha256Hex(material);
    }
  }

  if (!contentHash) {
    const { data: chunks } = await supabaseAdmin
      .from("au_document_chunks")
      .select("text")
      .eq("document_id", documentId)
      .order("chunk_index", { ascending: true })
      .limit(120);
    const chunkText = (chunks || []).map((row: any) => safeString(row?.text)).join("\n\n");
    if (chunkText) {
      contentHash = await sha256Hex(chunkText);
    }
  }

  if (!contentHash) {
    return { documentId, versionId: null, contentHash: null };
  }

  await supabaseAdmin
    .from("au_documents")
    .update({ content_hash: contentHash })
    .eq("id", documentId);

  const { data: upsertedVersion, error: upsertError } = await supabaseAdmin
    .from("au_document_versions")
    .upsert(
      {
        document_id: documentId,
        content_hash: contentHash,
        is_active: true,
      },
      { onConflict: "document_id,content_hash" },
    )
    .select("id")
    .maybeSingle();

  if (upsertError || !upsertedVersion?.id) {
    return { documentId, versionId: null, contentHash };
  }

  await supabaseAdmin
    .from("au_document_versions")
    .update({ is_active: false })
    .eq("document_id", documentId)
    .neq("id", upsertedVersion.id);

  return { documentId, versionId: upsertedVersion.id as string, contentHash };
}

export async function readIdempotentResponse(input: {
  supabaseAdmin: any;
  userId?: string | null;
  feature: string;
  idempotencyKey?: string | null;
  withinSeconds?: number;
}): Promise<{ statusCode: number; response: any } | null> {
  const supabaseAdmin = input.supabaseAdmin;
  const userId = safeString(input.userId);
  const feature = safeString(input.feature);
  const idempotencyKey = safeString(input.idempotencyKey);
  if (!supabaseAdmin || !userId || !feature || !idempotencyKey) return null;

  const withinSeconds = Number.isFinite(Number(input.withinSeconds))
    ? Math.max(1, Math.floor(Number(input.withinSeconds)))
    : 60;
  const minCreatedAt = new Date(Date.now() - withinSeconds * 1000).toISOString();

  const { data, error } = await supabaseAdmin
    .from("au_request_idempotency")
    .select("status_code,response_json,created_at")
    .eq("user_id", userId)
    .eq("feature", feature)
    .eq("idempotency_key", idempotencyKey)
    .gte("created_at", minCreatedAt)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return {
    statusCode: Number((data as any)?.status_code || 200),
    response: (data as any)?.response_json ?? null,
  };
}

export async function writeIdempotentResponse(input: {
  supabaseAdmin: any;
  userId?: string | null;
  feature: string;
  idempotencyKey?: string | null;
  requestHash?: string | null;
  response: any;
  statusCode?: number;
  requestId?: string | null;
  correlationId?: string | null;
  ttlSeconds?: number;
}): Promise<void> {
  const supabaseAdmin = input.supabaseAdmin;
  const userId = safeString(input.userId);
  const feature = safeString(input.feature);
  const idempotencyKey = safeString(input.idempotencyKey);
  if (!supabaseAdmin || !userId || !feature || !idempotencyKey) return;

  const ttlSeconds = Number.isFinite(Number(input.ttlSeconds))
    ? Math.max(5, Math.floor(Number(input.ttlSeconds)))
    : 60;
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();

  await supabaseAdmin
    .from("au_request_idempotency")
    .upsert(
      {
        user_id: userId,
        feature,
        idempotency_key: idempotencyKey,
        request_hash: safeString(input.requestHash) || null,
        response_json: input.response ?? {},
        status_code: Number(input.statusCode || 200) || 200,
        request_id: safeString(input.requestId) || null,
        correlation_id: safeString(input.correlationId) || null,
        expires_at: expiresAt,
      },
      { onConflict: "user_id,feature,idempotency_key" },
    );
}

export async function readFeatureOutputCache(input: {
  supabaseAdmin: any;
  userId: string;
  docVersionId?: string | null;
  feature: string;
}): Promise<any | null> {
  const supabaseAdmin = input.supabaseAdmin;
  const userId = safeString(input.userId);
  const docVersionId = safeString(input.docVersionId);
  const feature = safeString(input.feature);
  if (!supabaseAdmin || !userId || !docVersionId || !feature) return null;

  const { data, error } = await supabaseAdmin
    .from("au_feature_outputs")
    .select("output,status,model,tokens,cost_usd,created_at,updated_at")
    .eq("user_id", userId)
    .eq("doc_version_id", docVersionId)
    .eq("feature", feature)
    .maybeSingle();

  if (error || !data) return null;
  return data;
}

export async function writeFeatureOutputCache(input: {
  supabaseAdmin: any;
  userId: string;
  docVersionId?: string | null;
  feature: string;
  output: any;
  model?: string | null;
  tokens?: number | null;
  costUsd?: number | null;
  status?: string | null;
}): Promise<void> {
  const supabaseAdmin = input.supabaseAdmin;
  const userId = safeString(input.userId);
  const docVersionId = safeString(input.docVersionId);
  const feature = safeString(input.feature);
  if (!supabaseAdmin || !userId || !docVersionId || !feature) return;

  await supabaseAdmin
    .from("au_feature_outputs")
    .upsert(
      {
        user_id: userId,
        doc_version_id: docVersionId,
        feature,
        output: input.output ?? {},
        status: safeString(input.status) || "ready",
        model: safeString(input.model) || null,
        tokens: Number.isFinite(Number(input.tokens)) ? Number(input.tokens) : 0,
        cost_usd: Number.isFinite(Number(input.costUsd)) ? Number(input.costUsd) : null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,doc_version_id,feature" },
    );
}
