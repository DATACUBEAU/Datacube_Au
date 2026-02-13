# Security Review: Edge Function & RLS Policies

## 1. Edge Function Security Review

### ✅ **Strengths**

1. **Proper Authentication Flow**
   - ✅ Uses `SUPABASE_ANON_KEY` (not service role) for user queries
   - ✅ Forwards JWT via `Authorization` header correctly
   - ✅ Relies on RLS for access control (no manual user checks)

2. **Service Role Isolation**
   - ✅ Service role only used for secrets (API key retrieval)
   - ✅ Separate client instances prevent credential leakage

3. **Error Handling**
   - ✅ Distinguishes auth errors (401) from other errors
   - ✅ Proper error propagation

### ⚠️ **Security Issues Found**

#### **CRITICAL: Missing Input Validation**
```typescript
// Line 85: No validation on jobId
const { jobId } = await req.json();
if (!jobId) { ... } // Only checks existence, not format
```

**Risk:** UUID injection, potential for SQL injection if jobId used incorrectly
**Fix:** Validate UUID format:
```typescript
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if (!jobId || !UUID_REGEX.test(jobId)) {
  return new Response(JSON.stringify({ error: "Invalid jobId format" }), {
    status: 400,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
```

#### **HIGH: Missing Error Handling for Critical Operations**
```typescript
// Lines 209-212: No error handling for delete operation
await supabase
  .from("au_document_chunks")
  .delete()
  .eq("document_id", job.document_id);
```

**Risk:** Silent failures, potential data inconsistency
**Fix:** Add error handling:
```typescript
const { error: deleteErr } = await supabase
  .from("au_document_chunks")
  .delete()
  .eq("document_id", job.document_id);

if (deleteErr) {
  // Log and handle error
  throw new Error(`Failed to delete chunks: ${deleteErr.message}`);
}
```

#### **MEDIUM: Missing Rate Limiting**
**Risk:** DoS attacks, resource exhaustion
**Recommendation:** Add rate limiting at Edge Function level or use Supabase's built-in rate limiting

#### **MEDIUM: Missing Request Size Limits**
**Risk:** Large file processing could exhaust memory
**Fix:** Add file size validation before processing:
```typescript
if (job.file_size_bytes > 50 * 1024 * 1024) { // 50MB limit
  throw new Error("File too large for processing");
}
```

#### **LOW: Missing Progress Updates During Long Operations**
**Risk:** No visibility into processing status
**Recommendation:** Add progress updates during embedding generation

#### **LOW: Missing Timeout Handling**
**Risk:** Long-running operations could hang indefinitely
**Recommendation:** Add timeout for OpenAI/AU API calls

### 🔧 **Best Practice Improvements**

1. **Add Request Logging** (without sensitive data):
```typescript
console.log(`Processing job ${jobId} for user ${job.user_id}`);
```

2. **Add Operation Timeouts**:
```typescript
const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), 300000); // 5 min timeout
```

3. **Validate File Types Before Processing**:
```typescript
const allowedTypes = ['.txt', '.md', '.pdf', '.docx', '.pptx'];
if (!allowedTypes.some(ext => name.endsWith(ext))) {
  throw new Error("Unsupported file type");
}
```

---

## 2. RLS Policy Review

### **au_upload_jobs Table**

#### ✅ **Current Policies (Lines 31-42)**
```sql
CREATE POLICY "Users can view own upload jobs" ON au_upload_jobs
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own upload jobs" ON au_upload_jobs
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own upload jobs" ON au_upload_jobs
  FOR UPDATE USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own upload jobs" ON au_upload_jobs
  FOR DELETE USING (auth.uid() = user_id);
```

#### ⚠️ **Issues Found**

1. **Performance Issue: auth.uid() Re-evaluation**
   - **Problem:** `auth.uid()` is called for each row, causing performance degradation
   - **Impact:** 10x+ slower queries at scale
   - **Fix:**
   ```sql
   -- BEFORE (slow)
   USING (auth.uid() = user_id);
   
   -- AFTER (fast)
   USING ((SELECT auth.uid()) = user_id);
   ```

2. **Missing WITH CHECK on UPDATE**
   - **Current:** Has both USING and WITH CHECK (✅ correct)
   - **Status:** No issue here

3. **No Index Optimization**
   - **Current:** Index exists on `user_id` (✅ good)
   - **Recommendation:** Consider composite index if queries filter by status + user_id

### **au_documents Table**

#### ✅ **Current Policies (Lines 21-35)**
```sql
CREATE POLICY "Users can view own documents"
  ON au_documents FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own documents"
  ON au_documents FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own documents"
  ON au_documents FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own documents"
  ON au_documents FOR DELETE
  USING (auth.uid() = user_id);
```

#### ⚠️ **Issues Found**

1. **Missing WITH CHECK on UPDATE**
   - **Problem:** UPDATE policy only has USING, missing WITH CHECK
   - **Risk:** Users could update documents to change ownership
   - **Fix:**
   ```sql
   CREATE POLICY "Users can update own documents"
     ON au_documents FOR UPDATE
     USING (auth.uid() = user_id)
     WITH CHECK (auth.uid() = user_id); -- ADD THIS
   ```

2. **Performance Issue: auth.uid() Re-evaluation**
   - Same issue as above - use `(SELECT auth.uid())`

### **au_document_chunks Table**

#### ✅ **Current Policies (Lines 50-52)**
```sql
CREATE POLICY "Users can view own chunks"
  ON au_document_chunks FOR SELECT
  USING (auth.uid() = user_id);
```

#### ⚠️ **CRITICAL Issues Found**

1. **Missing INSERT Policy**
   - **Problem:** Edge Function inserts chunks but no INSERT policy exists
   - **Risk:** RLS will block all inserts, causing function to fail
   - **Fix:**
   ```sql
   CREATE POLICY "Users can insert own chunks"
     ON au_document_chunks FOR INSERT
     WITH CHECK (auth.uid() = user_id);
   ```

2. **Missing UPDATE Policy**
   - **Problem:** If chunks need updating, no policy exists
   - **Risk:** Updates will fail
   - **Fix:** Add if needed:
   ```sql
   CREATE POLICY "Users can update own chunks"
     ON au_document_chunks FOR UPDATE
     USING (auth.uid() = user_id)
     WITH CHECK (auth.uid() = user_id);
   ```

3. **Missing DELETE Policy**
   - **Problem:** Edge Function deletes chunks but no DELETE policy exists
   - **Risk:** RLS will block deletes, causing function to fail
   - **Fix:**
   ```sql
   CREATE POLICY "Users can delete own chunks"
     ON au_document_chunks FOR DELETE
     USING (auth.uid() = user_id);
   ```

4. **Performance Issue: auth.uid() Re-evaluation**
   - Same performance issue

### **au_api_keys Table**

#### ✅ **Current Policy (Lines 65-70)**
```sql
CREATE POLICY "Service role can access keys"
  ON au_api_keys
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
```

#### ✅ **Status: Secure**
- ✅ Only service_role can access
- ✅ Blocks all anon/authenticated users
- ✅ No issues found

---

## 3. Gold-Standard Anonymous-Safe Edge Function Template

```typescript
/// <reference path="../deno.d.ts" />
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeaders } from "../_shared/ai.ts";

// ============================================
// GOLD-STANDARD ANONYMOUS-SAFE EDGE FUNCTION
// ============================================
// ✅ Uses ANON_KEY with forwarded JWT
// ✅ Relies on RLS for access control
// ✅ Works with anonymous users
// ✅ Proper error handling
// ✅ Input validation
// ✅ Service role only for secrets
// ============================================

serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // 1. Extract and validate Authorization header
    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Missing or invalid Authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2. Create user-bound client (works for authenticated AND anonymous users)
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!, // ✅ ANON_KEY, not service role
      {
        global: {
          headers: { Authorization: authHeader }, // ✅ Forward JWT
        },
      }
    );

    // 3. Validate input
    const body = await req.json().catch(() => null);
    if (!body) {
      return new Response(
        JSON.stringify({ error: "Invalid JSON body" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { resourceId } = body;
    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!resourceId || !UUID_REGEX.test(resourceId)) {
      return new Response(
        JSON.stringify({ error: "Invalid resourceId format" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 4. Query with RLS enforcement (✅ RLS handles auth.uid() check)
    const { data: resource, error: resourceErr } = await supabase
      .from("your_table")
      .select("*")
      .eq("id", resourceId)
      .single();

    // 5. Handle RLS/auth errors properly
    if (resourceErr) {
      const isAuthError =
        resourceErr.code === "PGRST116" || // No rows (RLS blocked)
        resourceErr.code === "42501" || // Insufficient privilege
        resourceErr.message?.toLowerCase().includes("permission") ||
        resourceErr.message?.toLowerCase().includes("policy") ||
        resourceErr.message?.toLowerCase().includes("row-level security");

      return new Response(
        JSON.stringify({
          error: isAuthError
            ? "Unauthorized: Resource not found or access denied"
            : resourceErr.message,
        }),
        {
          status: isAuthError ? 401 : 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (!resource) {
      return new Response(
        JSON.stringify({ error: "Resource not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 6. Perform operation with user-bound client (RLS enforced)
    const { error: updateErr } = await supabase
      .from("your_table")
      .update({ status: "processed" })
      .eq("id", resourceId);

    if (updateErr) {
      const isAuthError =
        updateErr.code === "42501" ||
        updateErr.message?.toLowerCase().includes("permission") ||
        updateErr.message?.toLowerCase().includes("policy");

      return new Response(
        JSON.stringify({
          error: isAuthError
            ? "Unauthorized: Cannot update resource"
            : updateErr.message,
        }),
        {
          status: isAuthError ? 401 : 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // 7. Use service role ONLY for secrets (if needed)
    // ✅ Isolated to separate client, only for non-user data
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    // Only use admin for: API keys, system config, etc.
    // NEVER use admin for user-owned data

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    const isAuthError =
      e.message?.toLowerCase().includes("unauthorized") ||
      e.message?.toLowerCase().includes("permission") ||
      e.message?.toLowerCase().includes("forbidden");

    return new Response(
      JSON.stringify({ error: e.message || "Internal server error" }),
      {
        status: isAuthError ? 401 : 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
```

---

## 4. MCP Access & Least Privilege Recommendations

### **Current MCP Access Risks**

Since your Edge Function has MCP (service role) access, here are critical recommendations:

### ✅ **Best Practices**

1. **Separate Service Role Client**
   ```typescript
   // ✅ GOOD: Isolated service role client
   const admin = createClient(
     Deno.env.get("SUPABASE_URL")!,
     Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
   );
   // Only use for: getApiKey(), system config, etc.
   ```

2. **Never Mix Clients**
   ```typescript
   // ❌ BAD: Using service role for user data
   const { data } = await admin.from("au_upload_jobs").select("*");
   
   // ✅ GOOD: Use user-bound client
   const { data } = await supabase.from("au_upload_jobs").select("*");
   ```

3. **Environment Variable Security**
   - ✅ Store `SUPABASE_SERVICE_ROLE_KEY` in Edge Function secrets (not code)
   - ✅ Never log service role key
   - ✅ Rotate keys regularly

4. **RLS Bypass Prevention**
   ```typescript
   // ❌ NEVER DO THIS:
   // Using service role bypasses RLS - allows access to ALL data
   const { data } = await admin
     .from("au_upload_jobs")
     .select("*")
     .eq("user_id", someUserId); // Still bypasses RLS!
   
   // ✅ ALWAYS DO THIS:
   // Use user-bound client - RLS enforces access
   const { data } = await supabase
     .from("au_upload_jobs")
     .select("*")
     .eq("id", jobId); // RLS ensures user can only see their own
   ```

5. **Audit Service Role Usage**
   - Log all service role operations
   - Monitor for unexpected access patterns
   - Set up alerts for service role usage

### **Recommended MCP Access Pattern**

```typescript
// Pattern: Separate concerns clearly
class EdgeFunctionHandler {
  private userClient: SupabaseClient; // For user data
  private adminClient: SupabaseClient; // For secrets only

  constructor(authHeader: string) {
    // User-bound client (RLS enforced)
    this.userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    // Admin client (bypasses RLS - use ONLY for secrets)
    this.adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
  }

  // ✅ Use user client for all user data
  async getUserData(resourceId: string) {
    return await this.userClient
      .from("user_table")
      .select("*")
      .eq("id", resourceId)
      .single();
  }

  // ✅ Use admin client ONLY for secrets
  async getSecret(service: string) {
    return await this.adminClient
      .from("au_api_keys")
      .select("key_value")
      .eq("service", service)
      .single();
  }
}
```

---

## 5. Summary of Required Fixes

### **Edge Function Fixes**
1. ✅ Add UUID validation for `jobId`
2. ✅ Add error handling for chunk delete operation
3. ✅ Add file size validation
4. ✅ Add progress updates during long operations
5. ✅ Add timeout handling for external API calls

### **RLS Policy Fixes**
1. ✅ **CRITICAL:** Add INSERT policy for `au_document_chunks`
2. ✅ **CRITICAL:** Add DELETE policy for `au_document_chunks`
3. ✅ Add WITH CHECK to UPDATE policy for `au_documents`
4. ✅ Optimize all policies: `auth.uid()` → `(SELECT auth.uid())`

### **MCP/Security Fixes**
1. ✅ Ensure service role only used for secrets
2. ✅ Add logging for service role operations
3. ✅ Rotate service role keys regularly
4. ✅ Monitor for unexpected service role usage

---

## 6. Priority Action Items

### **Immediate (Fix Now)**
1. Add INSERT/DELETE policies for `au_document_chunks` (function will fail without these)
2. Add UUID validation for `jobId`
3. Add error handling for chunk delete

### **High Priority (This Week)**
1. Optimize RLS policies with `(SELECT auth.uid())`
2. Add WITH CHECK to `au_documents` UPDATE policy
3. Add file size validation

### **Medium Priority (This Month)**
1. Add progress updates
2. Add timeout handling
3. Add request logging
4. Set up service role usage monitoring
