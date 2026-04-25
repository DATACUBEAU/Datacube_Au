import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { getCorsHeaders } from "../_shared/au.ts";
import {
  LimitExceededError,
  enforceLimitOrThrow,
  getEffectiveLimitsForUser,
  getLimitsFlags,
  readLimit,
  readUsageValue,
  touchUserActivity,
} from "../_shared/limits.ts";

const ALLOWED_EXTENSIONS = ["pdf", "docx", "pptx", "txt", "md", "csv", "xlsx"];
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

type JsonMap = Record<string, unknown>;

type UploadContext = {
  requestId: string;
  correlationId: string;
  action: string;
  userId: string | null;
  uploadId?: string | null;
  documentId?: string | null;
};

function toFutureIso(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

function isRecord(value: unknown): value is JsonMap {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : String(value ?? "");
}

function normalizeUuid(value: unknown): string | null {
  const text = asString(value).trim();
  if (!text || !UUID_REGEX.test(text)) return null;
  return text.toLowerCase();
}

function normalizeDocumentType(input: unknown): "main_textbook" | "past_questions" | "exam_questions" {
  const value = asString(input)
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (value === "exam_question" || value === "exam_questions") return "exam_questions";
  if (value === "past_question" || value === "past_questions") return "past_questions";
  return "main_textbook";
}

function sanitizeFileName(fileName: string): string {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function resolveMimeTypeFromFileName(fileName: string, fallback?: string): string {
  const safeFallback = asString(fallback).trim();
  if (safeFallback.length > 0 && safeFallback !== "application/octet-stream") return safeFallback;
  const ext = fileName.split(".").pop()?.toLowerCase() || "";
  return MIME_BY_EXTENSION[ext] || "application/octet-stream";
}

function serializeError(error: unknown): JsonMap {
  if (!error || typeof error !== "object") {
    return { message: asString(error), raw: error };
  }

  const err = error as any;
  const cause =
    err.cause && typeof err.cause === "object"
      ? {
          name: err.cause.name,
          message: err.cause.message,
          code: err.cause.code,
          stack: err.cause.stack,
        }
      : err.cause ?? null;

  return {
    name: err.name || "Error",
    message: err.message || "Unknown error",
    code: err.code ?? null,
    status: err.status ?? null,
    details: err.details ?? null,
    hint: err.hint ?? null,
    stack: err.stack ?? null,
    cause,
  };
}

function responseJson(
  status: number,
  corsHeaders: Record<string, string>,
  payload: JsonMap,
): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function errorResponse(
  status: number,
  corsHeaders: Record<string, string>,
  context: UploadContext,
  code: string,
  message: string,
  details?: JsonMap,
): Response {
  return responseJson(status, corsHeaders, {
    ok: false,
    code,
    message,
    correlation_id: context.correlationId,
    request_id: context.requestId,
    action: context.action,
    ...(details ? { details } : {}),
  });
}

function isMissingFunctionError(error: unknown): boolean {
  const row = error as any;
  const code = asString(row?.code).trim();
  const message = asString(row?.message).toLowerCase();
  const details = asString(row?.details).toLowerCase();
  return (
    code === "42883" ||
    code === "PGRST202" ||
    (message.includes("function") && message.includes("does not exist")) ||
    (message.includes("schema cache") && message.includes("function")) ||
    (details.includes("schema cache") && details.includes("function"))
  );
}

function mapKnownError(error: unknown): { status: number; code: string; message: string } | null {
  const row = error as any;
  const code = asString(row?.code).trim();
  const message = asString(row?.message || "").toLowerCase();

  if (message.includes("parent_document_expired")) {
    return {
      status: 400,
      code: "parent_document_expired",
      message: "Parent textbook is already expired. Attachment upload was rejected.",
    };
  }
  if (message.includes("parent_document_not_found")) {
    return {
      status: 400,
      code: "parent_document_not_found",
      message: "Parent textbook was not found for this attachment.",
    };
  }
  if (message.includes("parent_document_missing_expiry")) {
    return {
      status: 400,
      code: "parent_document_missing_expiry",
      message: "Parent textbook is missing expires_at; attachment cannot be linked.",
    };
  }
  if (code === "23505" && message.includes("au_worker_jobs_owner_upload_id_key")) {
    return {
      status: 409,
      code: "duplicate_upload_id",
      message: "This upload_id has already been finalized.",
    };
  }
  if (isMissingFunctionError(error)) {
    return {
      status: 500,
      code: "db_migration_required",
      message: "Required upload finalize RPC is missing. Apply latest migrations and reload schema cache.",
    };
  }
  if (code === "42703") {
    const missingCol = message.match(/column "(.+)" does not exist/)?.[1] || 
                      details.match(/column "(.+)" does not exist/)?.[1];
    return {
      status: 500,
      code: "schema_mismatch",
      message: missingCol 
        ? `Database schema mismatch: column "${missingCol}" is missing. Apply latest migrations.`
        : "Database schema mismatch detected. Apply latest migrations.",
    };
  }
  return null;
}

function resolveCorrelationId(req: Request, body: JsonMap): string {
  const fromHeader = req.headers.get("x-correlation-id");
  const fromBody =
    asString(body.correlationId || "").trim() ||
    asString(body.uploadId || "").trim() ||
    asString(body.jobId || "").trim();

  const candidate = (fromHeader || fromBody || "").trim();
  if (candidate.length > 0) return candidate;
  return crypto.randomUUID();
}

function extensionFromFileName(fileName: string): string {
  return fileName.split(".").pop()?.toLowerCase() || "";
}

function validateExtension(fileName: string): boolean {
  const extension = extensionFromFileName(fileName);
  return extension.length > 0 && ALLOWED_EXTENSIONS.includes(extension);
}

async function resolveUserIdFromAuthHeader(req: Request): Promise<string | null> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return null;

  const token = authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice("bearer ".length).trim()
    : authHeader.trim();

  if (!token || token === "undefined" || token === "null") return null;

  const supabaseAnon = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: `Bearer ${token}` } } },
  );

  const { data: { user } } = await supabaseAnon.auth.getUser(token);
  return user?.id ?? null;
}

async function writeAuditLog(
  supabaseAdmin: any,
  context: UploadContext,
  status: "ok" | "error",
  details: JsonMap,
  errorCode?: string,
  errorMessage?: string,
) {
  try {
    await supabaseAdmin.from("au_upload_audit_log").insert({
      correlation_id: context.correlationId,
      upload_id: context.uploadId ?? null,
      document_id: context.documentId ?? null,
      owner_id: context.userId ?? null,
      action: context.action,
      status,
      error_code: errorCode ?? null,
      error_message: errorMessage ?? null,
      details,
      created_at: new Date().toISOString(),
    });
  } catch {
    // Best effort only.
  }
}

async function assertStorageObjectExists(input: {
  supabaseAdmin: any;
  bucket: string;
  objectPath: string;
  expectedSizeBytes: number;
  expectedMimeType: string;
}): Promise<{
  sizeBytes: number | null;
  contentType: string | null;
}> {
  const { supabaseAdmin, bucket, objectPath, expectedSizeBytes, expectedMimeType } = input;
  const pathParts = objectPath.split("/");
  const objectName = pathParts.pop() || "";
  const folder = pathParts.join("/");

  const { data, error } = await supabaseAdmin.storage
    .from(bucket)
    .list(folder, { search: objectName, limit: 5 });

  if (error) {
    throw Object.assign(new Error("storage_metadata_lookup_failed"), {
      code: "storage_metadata_lookup_failed",
      details: {
        message: error.message,
        hint: error.hint,
        details: error.details,
      },
    });
  }

  const uploadedFile = (data || []).find((row: any) => asString(row?.name) === objectName);
  if (!uploadedFile) {
    throw Object.assign(new Error("uploaded_object_missing"), {
      code: "uploaded_object_missing",
      status: 409,
      details: {
        bucket,
        object_path: objectPath,
      },
    });
  }

  const rawSize =
    Number(uploadedFile?.metadata?.size) ||
    Number(uploadedFile?.metadata?.contentLength) ||
    Number(uploadedFile?.size) ||
    0;

  const sizeBytes = Number.isFinite(rawSize) && rawSize > 0 ? rawSize : null;
  const contentType = asString(
    uploadedFile?.metadata?.mimetype ||
    uploadedFile?.metadata?.contentType ||
    uploadedFile?.mimetype ||
    "",
  ).trim() || null;

  if (expectedSizeBytes > 0 && sizeBytes !== null && sizeBytes !== expectedSizeBytes) {
    throw Object.assign(new Error("uploaded_object_size_mismatch"), {
      code: "uploaded_object_size_mismatch",
      status: 409,
      details: {
        bucket,
        object_path: objectPath,
        expected_size: expectedSizeBytes,
        actual_size: sizeBytes,
      },
    });
  }

  if (
    expectedMimeType &&
    contentType &&
    contentType !== expectedMimeType &&
    expectedMimeType !== "application/octet-stream"
  ) {
    throw Object.assign(new Error("uploaded_object_type_mismatch"), {
      code: "uploaded_object_type_mismatch",
      status: 409,
      details: {
        bucket,
        object_path: objectPath,
        expected_mime_type: expectedMimeType,
        actual_mime_type: contentType,
      },
    });
  }

  return { sizeBytes, contentType };
}

function isMissingColumnError(error: any, columnName?: string): boolean {
  const code = asString(error?.code).trim();
  const message = asString(error?.message).toLowerCase();
  const details = asString(error?.details).toLowerCase();
  if (code === "42703") {
    if (!columnName) return true;
    const lowered = columnName.toLowerCase();
    return message.includes(lowered) || details.includes(lowered);
  }
  if (!columnName) {
    return (
      (message.includes("column") && message.includes("does not exist")) ||
      (details.includes("column") && details.includes("does not exist"))
    );
  }
  const lowered = columnName.toLowerCase();
  return (
    (message.includes(lowered) && message.includes("does not exist")) ||
    (details.includes(lowered) && details.includes("does not exist"))
  );
}

async function selectOwnedDocument(
  supabaseAdmin: any,
  documentId: string,
  userId: string,
) {
  const ownerSelectColumns = "id, owner_id, user_id, file_path, file_name, status, document_type, expires_at";
  const legacySelectColumns = "id, user_id, file_path, file_name, status, document_type, expires_at";
  const byOwner = await supabaseAdmin
    .from("au_documents")
    .select(ownerSelectColumns)
    .eq("id", documentId)
    .eq("owner_id", userId)
    .maybeSingle();

  if (!byOwner.error) {
    return byOwner;
  }

  if (!isMissingColumnError(byOwner.error, "owner_id")) {
    return byOwner;
  }

  return await supabaseAdmin
    .from("au_documents")
    .select(legacySelectColumns)
    .eq("id", documentId)
    .eq("user_id", userId)
    .maybeSingle();
}

async function countOwnedDocuments(supabaseAdmin: any, userId: string): Promise<number> {
  const byOwner = await supabaseAdmin
    .from("au_documents")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", userId);

  if (!byOwner.error) return Number(byOwner.count || 0);
  if (!isMissingColumnError(byOwner.error, "owner_id")) throw byOwner.error;

  const byUser = await supabaseAdmin
    .from("au_documents")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);
  if (byUser.error) throw byUser.error;
  return Number(byUser.count || 0);
}

async function countActiveJobsForOwner(supabaseAdmin: any, userId: string): Promise<number> {
  const byOwner = await supabaseAdmin
    .from("au_worker_jobs")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", userId)
    .in("status", ["queued", "uploaded", "processing"]);

  if (!byOwner.error) return Number(byOwner.count || 0);
  if (!isMissingColumnError(byOwner.error, "owner_id")) throw byOwner.error;

  const byUser = await supabaseAdmin
    .from("au_worker_jobs")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .in("status", ["queued", "uploaded", "processing"]);
  if (byUser.error) throw byUser.error;
  return Number(byUser.count || 0);
}

async function selectExistingUploadFinalize(
  supabaseAdmin: any,
  userId: string,
  uploadId: string,
  documentId: string,
) {
  let byUpload = await supabaseAdmin
    .from("au_worker_jobs")
    .select("id, document_id, status")
    .eq("owner_id", userId)
    .eq("upload_id", uploadId)
    .maybeSingle();

  if (byUpload.error && isMissingColumnError(byUpload.error, "owner_id")) {
    byUpload = await supabaseAdmin
      .from("au_worker_jobs")
      .select("id, document_id, status")
      .eq("user_id", userId)
      .eq("upload_id", uploadId)
      .maybeSingle();
  }

  if (!byUpload.error && byUpload.data?.id) return byUpload;
  if (byUpload.error && !isMissingColumnError(byUpload.error, "owner_id")) return byUpload;

  const byDocument = await supabaseAdmin
    .from("au_worker_jobs")
    .select("id, document_id, status")
    .eq("document_id", documentId)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return byDocument;
}

async function legacyFinalizeDocumentUpload(input: {
  supabaseAdmin: any;
  userId: string;
  documentId: string;
  uploadId: string;
  jobId: string;
  bucket: string;
  expectedPath: string;
  fileName: string;
  mimeType: string;
  numericFileSize: number;
  metadata: JsonMap;
  correlationId: string;
}): Promise<JsonMap> {
  const {
    supabaseAdmin,
    userId,
    documentId,
    uploadId,
    jobId,
    bucket,
    expectedPath,
    fileName,
    mimeType,
    numericFileSize,
    metadata,
    correlationId,
  } = input;

  let tryExistingByUpload = await supabaseAdmin
    .from("au_worker_jobs")
    .select("id, document_id, status")
    .eq("owner_id", userId)
    .eq("upload_id", uploadId)
    .maybeSingle();

  if (tryExistingByUpload.error && isMissingColumnError(tryExistingByUpload.error, "owner_id")) {
    tryExistingByUpload = await supabaseAdmin
      .from("au_worker_jobs")
      .select("id, document_id, status")
      .eq("user_id", userId)
      .eq("upload_id", uploadId)
      .maybeSingle();
  }

  if (!tryExistingByUpload.error && tryExistingByUpload.data?.id) {
    return {
      ok: true,
      already_finalized: true,
      job_id: tryExistingByUpload.data.id,
      document_id: tryExistingByUpload.data.document_id || documentId,
    };
  }

  const tryExistingByDocument = await supabaseAdmin
    .from("au_worker_jobs")
    .select("id, document_id, status")
    .eq("document_id", documentId)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!tryExistingByDocument.error && tryExistingByDocument.data?.id) {
    return {
      ok: true,
      already_finalized: true,
      job_id: tryExistingByDocument.data.id,
      document_id: tryExistingByDocument.data.document_id || documentId,
    };
  }

  const nowIso = new Date().toISOString();
  const basePayload: Record<string, unknown> = {
    id: jobId,
    document_id: documentId,
    user_id: userId,
    owner_id: userId,
    upload_id: uploadId,
    correlation_id: correlationId,
    file_name: fileName,
    mime_type: mimeType,
    file_size_bytes: numericFileSize,
    bucket,
    object_path: expectedPath,
    status: "queued",
    progress: 0,
    worker_id: "vps-worker",
    metadata,
    created_at: nowIso,
    updated_at: nowIso,
  };

  const payloadVariants: Array<Record<string, unknown>> = [
    { ...basePayload },
    (() => {
      const p = { ...basePayload };
      delete p.correlation_id;
      delete p.worker_id;
      return p;
    })(),
    (() => {
      const p = { ...basePayload };
      delete p.upload_id;
      delete p.correlation_id;
      delete p.worker_id;
      return p;
    })(),
    (() => {
      const p = { ...basePayload };
      delete p.owner_id;
      delete p.upload_id;
      delete p.correlation_id;
      delete p.worker_id;
      return p;
    })(),
    (() => {
      const p = { ...basePayload };
      delete p.owner_id;
      delete p.upload_id;
      delete p.correlation_id;
      delete p.worker_id;
      delete p.metadata;
      delete p.created_at;
      delete p.updated_at;
      return p;
    })(),
  ];

  let insertedJobId: string | null = null;
  let lastInsertError: any = null;
  for (const payload of payloadVariants) {
    const { data, error } = await supabaseAdmin
      .from("au_worker_jobs")
      .upsert(payload, { onConflict: "id" })
      .select("id")
      .maybeSingle();

    if (!error) {
      insertedJobId = asString(data?.id || jobId);
      break;
    }

    if (String(error?.code || "") === "23505") {
      insertedJobId = jobId;
      break;
    }

    if (!isMissingColumnError(error)) {
      lastInsertError = error;
      break;
    }

    lastInsertError = error;
  }

  if (!insertedJobId) {
    throw lastInsertError || new Error("legacy_finalize_insert_failed");
  }

  const currentDocPayload = {
    status: "uploaded",
    file_name: fileName,
    file_path: expectedPath,
    file_size_bytes: numericFileSize,
  };
  const legacyDocPayload = {
    status: "uploaded",
    file_name: fileName,
    file_path: expectedPath,
  };

  let ownerScopedUpdate = await supabaseAdmin
    .from("au_documents")
    .update(currentDocPayload)
    .eq("id", documentId)
    .eq("owner_id", userId);

  if (ownerScopedUpdate.error && isMissingColumnError(ownerScopedUpdate.error, "file_size_bytes")) {
    ownerScopedUpdate = await supabaseAdmin
      .from("au_documents")
      .update(legacyDocPayload)
      .eq("id", documentId)
      .eq("owner_id", userId);
  }

  if (ownerScopedUpdate.error) {
    if (!isMissingColumnError(ownerScopedUpdate.error, "owner_id")) {
      throw ownerScopedUpdate.error;
    }
    let userScopedUpdate = await supabaseAdmin
      .from("au_documents")
      .update(currentDocPayload)
      .eq("id", documentId)
      .eq("user_id", userId);
    if (userScopedUpdate.error && isMissingColumnError(userScopedUpdate.error, "file_size_bytes")) {
      userScopedUpdate = await supabaseAdmin
        .from("au_documents")
        .update(legacyDocPayload)
        .eq("id", documentId)
        .eq("user_id", userId);
    }
    if (userScopedUpdate.error) throw userScopedUpdate.error;
  }

  return {
    ok: true,
    already_finalized: false,
    job_id: insertedJobId,
    document_id: documentId,
  };
}

Deno.serve(async (req: Request) => {
  const requestId = crypto.randomUUID();
  let corsHeaders: Record<string, string> = {
    "Access-Control-Allow-Origin": "",
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-upsert, tus-resumable, upload-length, upload-metadata, upload-offset, x-correlation-id",
  };
  let activeContext: UploadContext = {
    requestId,
    correlationId: req.headers.get("x-correlation-id") || requestId,
    action: "unknown",
    userId: null,
    uploadId: null,
    documentId: null,
  };

  const envMissing = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"].filter((key) => !Deno.env.get(key));
  if (envMissing.length > 0) {
    return responseJson(500, corsHeaders, {
      ok: false,
      code: "server_misconfigured",
      message: `Missing required environment variables: ${envMissing.join(", ")}`,
      request_id: requestId,
    });
  }

  try {
    try {
      corsHeaders = getCorsHeaders(req);
    } catch (error) {
      console.warn("[document-upload] Failed to build CORS headers", serializeError(error));
    }

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    let body: JsonMap = {};
    try {
      const parsed = await req.json();
      body = isRecord(parsed) ? parsed : {};
    } catch {
      const context: UploadContext = {
        requestId,
        correlationId: req.headers.get("x-correlation-id") || requestId,
        action: "invalid_json",
        userId: null,
      };
      return errorResponse(400, corsHeaders, context, "invalid_json", "Request body must be valid JSON.");
    }

    const action = asString(body.action || "legacy").trim().toLowerCase();
    const correlationId = resolveCorrelationId(req, body);
    const context: UploadContext = {
      requestId,
      correlationId,
      action,
      userId: null,
      uploadId: normalizeUuid(body.uploadId || body.jobId),
      documentId: normalizeUuid(body.documentId),
    };
    activeContext = context;

    const bucket = asString(Deno.env.get("BUCKET") || "documents").trim() || "documents";
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const userId = await resolveUserIdFromAuthHeader(req);
    context.userId = userId;
    if (!userId) {
      return errorResponse(401, corsHeaders, context, "unauthorized", "Missing or invalid user session.");
    }

    if (action === "health" || action === "validate_schema") {
      const checks = [
        { table: "au_documents", column: "file_size_bytes" },
        { table: "au_documents", column: "owner_id" },
        { table: "au_worker_jobs", column: "file_size_bytes" },
        { table: "au_worker_jobs", column: "upload_id" },
        { table: "au_upload_audit_log", column: "id" },
      ];

      const results = await Promise.all(checks.map(async ({ table, column }) => {
        const { error } = await supabaseAdmin.from(table).select(column).limit(0);
        return {
          table,
          column,
          ok: !error,
          error: error ? { code: error.code, message: error.message } : null
        };
      }));

      const allOk = results.every(r => r.ok);
      return responseJson(allOk ? 200 : 500, corsHeaders, {
        ok: allOk,
        stage: "health_check",
        correlation_id: correlationId,
        checks: results
      });
    }

    if (action === "initiate") {
      const fileName = asString(body.fileName).trim();
      const numericFileSize = Number(body.fileSize || 0);
      const documentType = normalizeDocumentType(body.documentType);
      const parentDocumentId = normalizeUuid(body.parentDocumentId || body.parentId);
      const uploadId = normalizeUuid(body.uploadId || body.jobId || context.uploadId || crypto.randomUUID());
      const documentId = normalizeUuid(body.documentId || crypto.randomUUID());
      const metadata = isRecord(body.metadata) ? { ...body.metadata } : {};

      context.uploadId = uploadId;
      context.documentId = documentId;

      if (!fileName || !Number.isFinite(numericFileSize) || numericFileSize <= 0 || !uploadId || !documentId) {
        return errorResponse(
          400,
          corsHeaders,
          context,
          "invalid_request",
          "fileName, fileSize, uploadId/jobId, and documentId are required.",
        );
      }

      if (!validateExtension(fileName)) {
        return errorResponse(
          400,
          corsHeaders,
          context,
          "invalid_file_type",
          `Invalid file type. Allowed: ${ALLOWED_EXTENSIONS.join(", ")}`,
        );
      }

      const sizeMB = numericFileSize / (1024 * 1024);
      const [limitsState, limitsFlags] = await Promise.all([
        getEffectiveLimitsForUser(supabaseAdmin, userId),
        getLimitsFlags(supabaseAdmin),
      ]);
      const usageTotal = limitsState.usage?.total || {};
      const resetAt = limitsState.reset_at || limitsState.usage?.reset_at || null;
      const retentionDays = Math.max(1, Number(limitsState.retention_days || 14));
      const maxUploadsTotal = readLimit(limitsState.limits, "max_uploads_total", 40);
      const maxStorageMb = readLimit(limitsState.limits, "max_storage_mb", 1024);
      const uploadsTotal = readUsageValue(usageTotal as any, ["used_uploads", "uploads_count"], 0);
      const usedStorageMb = readUsageValue(usageTotal as any, ["used_storage_mb", "uploaded_mb"], 0);
      const maxDocsTotal = readLimit(limitsState.limits, "max_docs_total", 20);
      const effectiveMaxFileMb = readLimit(limitsState.limits, "max_file_size_mb", 50);
      const maxSizeBytes = Number.isFinite(effectiveMaxFileMb) && effectiveMaxFileMb >= 0
        ? Math.floor(Math.max(0, effectiveMaxFileMb) * 1024 * 1024)
        : Number.MAX_SAFE_INTEGER;

      enforceLimitOrThrow({
        enforcementEnabled: limitsFlags.enforcementEnabled,
        limitKey: "max_uploads_total",
        current: uploadsTotal,
        increment: 1,
        max: maxUploadsTotal,
        resetAt,
      });
      enforceLimitOrThrow({
        enforcementEnabled: limitsFlags.enforcementEnabled,
        limitKey: "max_storage_mb",
        current: usedStorageMb,
        increment: sizeMB,
        max: maxStorageMb,
        resetAt,
      });

      if (numericFileSize > maxSizeBytes) {
        return errorResponse(
          413,
          corsHeaders,
          context,
          "file_too_large",
          `File too large. Limit is ${effectiveMaxFileMb}MB.`,
          { max_file_mb: effectiveMaxFileMb, file_size_bytes: numericFileSize },
        );
      }

      const totalDocuments = await countOwnedDocuments(supabaseAdmin, userId);

      enforceLimitOrThrow({
        enforcementEnabled: limitsFlags.enforcementEnabled,
        limitKey: "max_docs_total",
        current: Number(totalDocuments || 0),
        increment: 1,
        max: maxDocsTotal,
        resetAt,
      });

      const safeFileName = sanitizeFileName(fileName);
      const storageFolder = documentType === "past_questions" || documentType === "exam_questions"
        ? "past-questions"
        : "main-textbooks";
      const filePath = `${userId}/ingestion/${storageFolder}/${uploadId}_${safeFileName}`;
      const resolvedMimeType = resolveMimeTypeFromFileName(fileName);

      const docMetadata: JsonMap = {
        ...metadata,
        upload_id: uploadId,
        correlation_id: correlationId,
      };

      const docPayload: JsonMap = {
        id: documentId,
        owner_id: userId,
        user_id: userId,
        file_name: fileName,
        file_path: filePath,
        file_size_bytes: numericFileSize,
        document_type: documentType,
        status: "pending_upload",
        parent_id: parentDocumentId,
        parent_document_id: parentDocumentId,
        metadata: docMetadata,
        expires_at: parentDocumentId ? null : toFutureIso(retentionDays),
        storage_deleted_at: null,
        source_deleted_at: null,
        source_cleanup_result: null,
      };

      const docPayloadVariants: JsonMap[] = [
        { ...docPayload },
        (() => {
          const p = { ...docPayload };
          delete p.file_size_bytes;
          delete p.parent_document_id;
          delete p.storage_deleted_at;
          delete p.source_deleted_at;
          delete p.source_cleanup_result;
          return p;
        })(),
        (() => {
          const p = { ...docPayload };
          delete p.owner_id;
          delete p.file_size_bytes;
          delete p.parent_document_id;
          delete p.storage_deleted_at;
          delete p.source_deleted_at;
          delete p.source_cleanup_result;
          return p;
        })(),
        (() => {
          const p = { ...docPayload };
          delete p.owner_id;
          delete p.file_size_bytes;
          delete p.parent_id;
          delete p.parent_document_id;
          delete p.storage_deleted_at;
          delete p.source_deleted_at;
          delete p.source_cleanup_result;
          return p;
        })(),
      ];

      let docUpsertError: any = null;
      for (const payload of docPayloadVariants) {
        const { error } = await supabaseAdmin
          .from("au_documents")
          .upsert(payload, { onConflict: "id" });

        if (!error) {
          docUpsertError = null;
          break;
        }

        docUpsertError = error;
        if (!isMissingColumnError(error)) {
          break;
        }
      }

      if (docUpsertError) throw docUpsertError;

      const { data: signData, error: signError } = await supabaseAdmin.storage
        .from(bucket)
        .createSignedUploadUrl(filePath, { upsert: true });

      if (signError) throw signError;

      await touchUserActivity(supabaseAdmin, userId, "activity");
      await writeAuditLog(supabaseAdmin, context, "ok", {
        stage: "initiate",
        bucket,
        path: filePath,
        file_name: fileName,
        file_size_bytes: numericFileSize,
      });

      return responseJson(200, corsHeaders, {
        ok: true,
        correlation_id: correlationId,
        uploadId,
        uploadUrl: signData.signedUrl,
        token: signData.token,
        path: signData.path,
        bucket,
        contentType: resolvedMimeType,
        documentId,
        jobId: normalizeUuid(body.jobId) || uploadId,
      });
    }

    if (action === "complete") {
      const documentId = normalizeUuid(body.documentId);
      const uploadId = normalizeUuid(body.uploadId || body.jobId);
      const jobId = normalizeUuid(body.jobId || uploadId);
      const fileName = asString(body.fileName).trim();
      const numericFileSize = Number(body.fileSize || 0);
      const metadata = isRecord(body.metadata) ? { ...body.metadata } : {};
      const expectedPathFromClient = asString(body.path).trim() || null;
      const expectedBucketFromClient = asString(body.bucket).trim() || null;
      const mimeType = resolveMimeTypeFromFileName(fileName, asString(body.mimeType));

      context.uploadId = uploadId;
      context.documentId = documentId;

      if (!documentId || !uploadId || !jobId || !fileName || !Number.isFinite(numericFileSize) || numericFileSize <= 0) {
        return errorResponse(
          400,
          corsHeaders,
          context,
          "invalid_request",
          "documentId, uploadId/jobId, fileName, and fileSize are required.",
        );
      }

      const { data: doc, error: docError } = await selectOwnedDocument(supabaseAdmin, documentId, userId);

      if (docError) throw docError;
      if (!doc) {
        return errorResponse(404, corsHeaders, context, "document_not_found", "Document was not found.");
      }

      const expectedPath = asString(doc.file_path).trim();
      if (!expectedPath) {
        return errorResponse(
          409,
          corsHeaders,
          context,
          "missing_storage_path",
          "Document record is missing storage path.",
        );
      }

      if (expectedBucketFromClient && expectedBucketFromClient !== bucket) {
        return errorResponse(
          409,
          corsHeaders,
          context,
          "bucket_mismatch",
          "Uploaded object bucket does not match initiated bucket.",
          { expected_bucket: bucket, received_bucket: expectedBucketFromClient },
        );
      }

      if (expectedPathFromClient && expectedPathFromClient !== expectedPath) {
        return errorResponse(
          409,
          corsHeaders,
          context,
          "object_path_mismatch",
          "Uploaded object path does not match initiated path.",
          { expected_path: expectedPath, received_path: expectedPathFromClient },
        );
      }

      const [limitsState, limitsFlags] = await Promise.all([
        getEffectiveLimitsForUser(supabaseAdmin, userId),
        getLimitsFlags(supabaseAdmin),
      ]);
      const maxFileMb = readLimit(limitsState.limits, "max_file_size_mb", 50);
      const maxSizeBytes = Number.isFinite(maxFileMb) && maxFileMb >= 0
        ? Math.floor(Math.max(0, maxFileMb) * 1024 * 1024)
        : Number.MAX_SAFE_INTEGER;

      if (numericFileSize > maxSizeBytes) {
        return errorResponse(
          413,
          corsHeaders,
          context,
          "file_too_large",
          `File too large. Limit is ${maxFileMb}MB.`,
          { max_file_mb: maxFileMb, file_size_bytes: numericFileSize },
        );
      }

      const storageMeta = await assertStorageObjectExists({
        supabaseAdmin,
        bucket,
        objectPath: expectedPath,
        expectedSizeBytes: numericFileSize,
          expectedMimeType: mimeType,
        });

      const existingFinalize = await selectExistingUploadFinalize(
        supabaseAdmin,
        userId,
        uploadId,
        documentId,
      );
      if (existingFinalize.error) throw existingFinalize.error;
      if (existingFinalize.data?.id) {
        await touchUserActivity(supabaseAdmin, userId, "activity");
        await writeAuditLog(supabaseAdmin, context, "ok", {
          stage: "complete",
          idempotent: true,
          job_id: existingFinalize.data.id,
          document_id: existingFinalize.data.document_id || documentId,
          bucket,
          path: expectedPath,
          storage_size_bytes: storageMeta.sizeBytes,
          storage_content_type: storageMeta.contentType,
        });

        return responseJson(200, corsHeaders, {
          ok: true,
          correlation_id: correlationId,
          uploadId,
          jobId: asString(existingFinalize.data.id || jobId),
          documentId: asString(existingFinalize.data.document_id || documentId),
          idempotent: true,
          storage: {
            bucket,
            object_path: expectedPath,
            size_bytes: storageMeta.sizeBytes,
            content_type: storageMeta.contentType,
          },
        });
      }

      const sizeMB = numericFileSize / (1024 * 1024);
      const resetAt = limitsState.reset_at || limitsState.usage?.reset_at || null;
      const usageTotal = limitsState.usage?.total || {};
      const uploadsTotal = readUsageValue(usageTotal as any, ["used_uploads", "uploads_count"], 0);
      const usedStorageMb = readUsageValue(usageTotal as any, ["used_storage_mb", "uploaded_mb"], 0);
      const maxUploadsTotal = readLimit(limitsState.limits, "max_uploads_total", 40);
      const maxStorageMb = readLimit(limitsState.limits, "max_storage_mb", 1024);
      const maxJobsConcurrent = readLimit(limitsState.limits, "max_concurrent_jobs", 2);

      enforceLimitOrThrow({
        enforcementEnabled: limitsFlags.enforcementEnabled,
        limitKey: "max_uploads_total",
        current: uploadsTotal,
        increment: 1,
        max: maxUploadsTotal,
        resetAt,
      });
      enforceLimitOrThrow({
        enforcementEnabled: limitsFlags.enforcementEnabled,
        limitKey: "max_storage_mb",
        current: usedStorageMb,
        increment: sizeMB,
        max: maxStorageMb,
        resetAt,
      });

      const activeJobsCount = await countActiveJobsForOwner(supabaseAdmin, userId);

      enforceLimitOrThrow({
        enforcementEnabled: limitsFlags.enforcementEnabled,
        limitKey: "max_concurrent_jobs",
        current: Number(activeJobsCount || 0),
        increment: 1,
        max: maxJobsConcurrent,
        resetAt,
      });

      const normalizedMetadata: JsonMap = {
        ...(metadata || {}),
        upload_id: uploadId,
        correlation_id: correlationId,
      };

      let { data: finalizeData, error: finalizeError } = await supabaseAdmin.rpc("finalize_document_upload", {
        p_owner_id: userId,
        p_document_id: documentId,
        p_upload_id: uploadId,
        p_job_id: jobId,
        p_bucket: bucket,
        p_object_path: expectedPath,
        p_file_name: fileName,
        p_mime_type: mimeType,
        p_file_size_bytes: numericFileSize,
        p_metadata: normalizedMetadata,
        p_correlation_id: correlationId,
      });

      if (finalizeError) {
        const mappedFinalize = mapKnownError(finalizeError);
        if (mappedFinalize && (mappedFinalize.code === "db_migration_required" || mappedFinalize.code === "schema_mismatch")) {
          console.warn("[document-upload] finalize_document_upload RPC unavailable or incompatible; using legacy finalize fallback.", {
            correlation_id: correlationId,
            code: mappedFinalize.code,
            message: mappedFinalize.message,
          });
          finalizeData = await legacyFinalizeDocumentUpload({
            supabaseAdmin,
            userId,
            documentId,
            uploadId,
            jobId,
            bucket,
            expectedPath,
            fileName,
            mimeType,
            numericFileSize,
            metadata: normalizedMetadata,
            correlationId,
          });
          finalizeError = null;
        }
      }

      if (finalizeError) throw finalizeError;

      const finalizePayload = isRecord(finalizeData) ? finalizeData : {};
      if (finalizePayload.ok !== true) {
        const code = asString(finalizePayload.code || "finalize_failed");
        if (code === "document_not_found") {
          return errorResponse(404, corsHeaders, context, "document_not_found", "Document was not found for finalize.");
        }
        return errorResponse(409, corsHeaders, context, code, asString(finalizePayload.message || "Finalize failed."));
      }

      const alreadyFinalized = finalizePayload.already_finalized === true;
      // Usage increment is tracked by the proxy usage-event ledger after successful completion.

      await touchUserActivity(supabaseAdmin, userId, "activity");
      await writeAuditLog(supabaseAdmin, context, "ok", {
        stage: "complete",
        idempotent: alreadyFinalized,
        job_id: finalizePayload.job_id || null,
        document_id: finalizePayload.document_id || documentId,
        bucket,
        path: expectedPath,
        storage_size_bytes: storageMeta.sizeBytes,
        storage_content_type: storageMeta.contentType,
      });

      return responseJson(200, corsHeaders, {
        ok: true,
        correlation_id: correlationId,
        uploadId,
        jobId: asString(finalizePayload.job_id || jobId),
        documentId: asString(finalizePayload.document_id || documentId),
        idempotent: alreadyFinalized,
        storage: {
          bucket,
          object_path: expectedPath,
          size_bytes: storageMeta.sizeBytes,
          content_type: storageMeta.contentType,
        },
      });
    }

    return errorResponse(
      400,
      corsHeaders,
      {
        requestId,
        correlationId: req.headers.get("x-correlation-id") || requestId,
        action,
        userId: null,
      },
      "invalid_action",
      "Invalid action. Use 'initiate' or 'complete'.",
    );
  } catch (error: unknown) {
    const serializedError = serializeError(error);
    const mapped = mapKnownError(error);
    const correlationId =
      (serializedError.correlation_id as string | undefined) ||
      req.headers.get("x-correlation-id") ||
      requestId;

    console.error("[document-upload] unhandled error", {
      request_id: requestId,
      correlation_id: correlationId,
      error: serializedError,
    });

    try {
      const supabaseAdmin = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      );
      await writeAuditLog(
        supabaseAdmin,
        {
          ...activeContext,
          correlationId,
        },
        "error",
        { error: serializedError },
        mapped?.code || asString((error as any)?.code || "internal_server_error"),
        mapped?.message || asString((error as any)?.message || "Unexpected server error."),
      );
    } catch {
      // Best effort only.
    }

    if (error instanceof LimitExceededError || (error as any)?.name === "LimitExceededError") {
      const payload = {
        ok: false,
        code: "LIMIT_EXCEEDED",
        correlation_id: correlationId,
        request_id: requestId,
        ...(error as any)?.payload,
      };
      return responseJson(
        typeof (error as any)?.status === "number" ? (error as any).status : 429,
        corsHeaders,
        payload,
      );
    }

    if (mapped) {
      return errorResponse(
        mapped.status,
        corsHeaders,
        {
          ...activeContext,
          correlationId,
        },
        mapped.code,
        mapped.message,
        { error: serializedError },
      );
    }

    const status = Number((error as any)?.status || 500);
    const code = asString((error as any)?.code || "internal_server_error");
    const message = asString((error as any)?.message || "Unexpected server error.");
    return errorResponse(
      Number.isFinite(status) && status > 0 ? status : 500,
      corsHeaders,
      {
        ...activeContext,
        correlationId,
      },
      code,
      message,
      { error: serializedError },
    );
  }
});
