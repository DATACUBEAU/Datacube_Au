# Migration Guide: Apply RLS Policy Fixes

## ⚠️ CRITICAL SECURITY ALERT

**Your service role key is exposed in `.env.local`!**

The file `.env.local` contains:
```
SUPABASE_SERVICE_ROLE_KEY=<redacted>
```

**Immediate Actions Required:**
1. **Rotate the service role key immediately** in your Supabase dashboard
2. **Add `.env.local` to `.gitignore`** (if not already)
3. **Never commit service role keys to version control**
4. **Use Supabase Edge Function secrets** for production keys

---

## Step 1: Apply RLS Policy Migration

Since Supabase CLI is not available, you have two options:

### Option A: Apply via Supabase Dashboard (Recommended)

1. Go to your Supabase Dashboard → SQL Editor
2. Copy the contents of `backend/supabase/migrations/20240111000000_fix_rls_policies.sql`
3. Paste and execute in the SQL Editor
4. Verify all policies were created successfully

### Option B: Use Supabase MCP (if available)

If you have MCP access configured, you can apply the migration using the MCP tools.

---

## Step 2: Verify Edge Function Replacement

✅ **Already Completed:**
- `index.ts` has been replaced with `index.secure.ts`
- All security features are in place

### Security Features Verified:

✅ **UUID Validation**
- Line 17: `UUID_REGEX` constant defined
- Line 82: `validateUUID()` function
- Line 122: Validation applied to `jobId`

✅ **File Size Check**
- Line 18: `MAX_FILE_SIZE` constant (50MB)
- Line 158: File size validation before processing

✅ **Timeout Handling**
- Line 19: `OPENAI_TIMEOUT` constant (30 seconds)
- Line 323: Timeout implemented for OpenAI API calls
- Line 339, 352: Proper timeout cleanup

✅ **Error Handling**
- Line 72: `isAuthError()` helper function
- Comprehensive error handling for all DB operations
- Proper HTTP status codes (401 for auth, 400/500 for others)

✅ **Input Validation**
- Line 20: `ALLOWED_EXTENSIONS` whitelist
- File type validation before processing
- JSON body validation

---

## Step 3: Deploy Updated Edge Function

After applying the migration, deploy the updated Edge Function:

```bash
# If using Supabase CLI (when available)
supabase functions deploy process-upload-job

# Or use Supabase Dashboard:
# Dashboard → Edge Functions → process-upload-job → Deploy
```

---

## Step 4: Test the Function

1. Upload a test file
2. Verify processing completes successfully
3. Check that RLS policies are working (users can only see their own jobs)
4. Verify error messages are clear and helpful

---

## Verification Checklist

- [ ] RLS migration applied successfully
- [ ] Edge Function deployed with secure version
- [ ] UUID validation working (try invalid UUID - should return 400)
- [ ] File size check working (try file > 50MB - should be rejected)
- [ ] Timeout handling working (should abort after 30s)
- [ ] Error handling working (clear error messages)
- [ ] Service role key rotated (if exposed)
- [ ] `.env.local` added to `.gitignore`

---

## Rollback Plan

If issues occur, you can rollback:

1. **RLS Policies:** Re-run the original migration to restore old policies
2. **Edge Function:** Revert to previous version via Supabase Dashboard

---

## Next Steps

1. Monitor Edge Function logs for any errors
2. Set up alerts for failed processing jobs
3. Review and apply security fixes to other Edge Functions
4. Consider implementing rate limiting
5. Set up service role usage monitoring
