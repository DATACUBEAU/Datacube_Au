# user_id Injection Points in process-upload-job Edge Function

## 📍 File: `backend/supabase/functions/process-upload-job/index.ts`

---

## 🔴 CRITICAL: user_id Injection Point #1 - Chunk Insert (Line 372)

**This is the MAIN FIX that resolves the "Unauthorized: Cannot insert chunks" error.**

```typescript
// Line 367-377
const { data: inserted, error: insertErr } = await supabase
  .from("au_document_chunks")
  .insert(
    chunks.map((t, i) => ({
      document_id: job.document_id,
      user_id: job.user_id, // ✅✅✅ INJECTED HERE - REQUIRED FOR RLS ✅✅✅
      chunk_index: i,
      text: t,
    }))
  )
  .select("id, text");
```

**Why this matters:**
- RLS policy requires: `WITH CHECK (auth.uid() = user_id)`
- Without `user_id`, RLS rejects the insert → "Unauthorized"
- With `user_id: job.user_id`, RLS allows the insert → ✅ Success

---

## 🟡 Safety Guard #1 - Early Validation (Line 172-185)

**Validates user_id exists BEFORE any processing:**

```typescript
// Line 172-185
// 5. CRITICAL: Validate job.user_id exists (required for RLS)
if (!job.user_id || typeof job.user_id !== 'string') {
  console.error(`[process-upload-job] Missing user_id on job`, {
    jobId: job.id,
    jobStatus: job.status,
    documentId: job.document_id,
  });
  return new Response(
    JSON.stringify({ 
      error: "Invalid job: missing user_id. This job cannot be processed." 
    }),
    { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}
```

**Purpose:** Prevents processing jobs that don't have `user_id`, saving time and providing clear errors.

---

## 🟡 Safety Guard #2 - Pre-Insert Check (Line 358-365)

**Double-checks user_id right before chunk insert:**

```typescript
// Line 358-365
// Double-check user_id before insert (safety guard)
if (!job.user_id) {
  console.error(`[process-upload-job] CRITICAL: user_id missing before chunk insert`, {
    jobId: job.id,
    documentId: job.document_id,
  });
  throw new Error("Missing user_id on upload job - cannot insert chunks");
}
```

**Purpose:** Final safety check immediately before the critical insert operation.

---

## 🟢 Logging - user_id Verification (Line 188-194, 351-356)

**Logs user_id at key points for debugging:**

```typescript
// Line 188-194: Pipeline start
console.log(`[process-upload-job] Starting processing`, {
  jobId: job.id,
  userId: job.user_id, // ✅ Logged for verification
  documentId: job.document_id,
  fileName: job.file_name,
  fileSize: job.file_size_bytes,
});

// Line 351-356: Before chunk insert
console.log(`[process-upload-job] Inserting chunks`, { 
  jobId: job.id, 
  documentId: job.document_id, 
  userId: job.user_id, // ✅ Logged to verify user_id is present
  chunkCount: chunks.length 
});
```

**Purpose:** Helps debug issues by showing `user_id` value at critical stages.

---

## 🔵 Auth Context - user_id Source (Line 145-149)

**Where user_id comes from (fetched from job):**

```typescript
// Line 145-149
// 4. Fetch job with RLS enforcement
const { data: job, error: jobErr } = await supabase
  .from("au_upload_jobs")
  .select("*")  // ✅ Includes user_id column
  .eq("id", jobId)
  .single();

// job.user_id is now available for use
```

**Purpose:** Fetches the job record which contains `user_id` that was set when the job was created.

---

## 📊 Complete Flow Diagram

```
1. Request arrives with jobId
   ↓
2. Fetch job from au_upload_jobs (Line 145-149)
   → job.user_id is retrieved
   ↓
3. Validate job.user_id exists (Line 172-185) ✅ Safety Guard #1
   → If missing: Return error 400
   → If present: Continue
   ↓
4. Process file (extract text, create chunks)
   ↓
5. Double-check job.user_id (Line 358-365) ✅ Safety Guard #2
   → If missing: Throw error
   → If present: Continue
   ↓
6. Insert chunks WITH user_id (Line 367-377) ✅✅✅ MAIN FIX ✅✅✅
   → user_id: job.user_id included in each chunk
   → RLS checks: auth.uid() = user_id
   → ✅ PASS: Chunks inserted successfully
   ↓
7. Continue processing (embeddings, finalize)
```

---

## 🎯 Key Points

### ✅ What's Fixed:
1. **Line 372:** `user_id: job.user_id` is now included in chunk inserts
2. **Line 172-185:** Early validation prevents processing invalid jobs
3. **Line 358-365:** Pre-insert safety check
4. **Line 188-194, 351-356:** Logging shows `user_id` at critical points

### ✅ RLS Policy Match:
- **Policy:** `WITH CHECK (auth.uid() = user_id)`
- **Insert:** `user_id: job.user_id`
- **Result:** When `auth.uid()` equals `job.user_id`, RLS allows the insert

### ✅ Security:
- `user_id` comes from the job (which was created by the authenticated user)
- RLS ensures `auth.uid() === job.user_id` (user can only process their own jobs)
- No manual user checks needed - RLS handles it

---

## 📝 Summary

**The critical fix is on Line 372:**
```typescript
user_id: job.user_id, // Required for RLS policy: auth.uid() = user_id
```

This single line addition fixes the "Unauthorized: Cannot insert chunks" error by ensuring every chunk insert includes the `user_id` that RLS requires.

**Before:** Chunks inserted without `user_id` → RLS rejects → Error  
**After:** Chunks inserted with `user_id: job.user_id` → RLS allows → ✅ Success
