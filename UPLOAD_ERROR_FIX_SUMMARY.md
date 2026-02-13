# Upload Error Fix Summary

## Issues Fixed

### 1. ✅ Error Message Not Displayed
**Problem:** Job shows "Failed" status but no error message appears in UI.

**Root Cause:**
- Error message extraction from Edge Function response wasn't comprehensive
- Error field might be null/empty in database
- UI only showed error if `job.error` was truthy

**Fix Applied:**
1. **Enhanced error extraction** (upload-jobs-provider.tsx, lines 193-230):
   - Multiple fallback methods to extract error message
   - Checks `e.message`, `e.response.error`, `e.error`, and string type
   - Provides default message if all fail
   - Comprehensive logging for debugging

2. **UI fallback display** (upload-center.tsx, line 345):
   - Shows error message even if `job.error` is null
   - Displays "Processing failed. Check logs for details." as fallback
   - Only shows for `status === 'failed'`

### 2. ✅ Document Status Not Updated on Failure
**Problem:** Document status remains "uploading" or "processing" when job fails, so it doesn't appear in collections (which filter by `status = 'completed'`).

**Fix Applied:**
- Document status is now updated to "failed" when processing fails
- Includes error message in document record
- Proper error handling with logging

### 3. ✅ Better Error Logging
**Added:**
- Console logging of full error object
- Error type and keys logged for debugging
- Success logging when processing completes
- Document status update confirmation logging

## Code Changes

### `src/components/upload/upload-jobs-provider.tsx`

**Lines 190-230:** Enhanced error handling in `runProcessing`
```typescript
try {
  const result = await invokeEdgeFunction('process-upload-job', { jobId }, token);
  console.log(`[upload-jobs] Processing completed for job ${jobId}:`, result);
  await refreshJobs();
} catch (e: any) {
  // Multiple fallback methods to extract error message
  let message = 'Processing failed. Unknown error.';
  if (typeof e?.message === 'string' && e.message.trim()) {
    message = e.message.trim();
  } else if (e?.response?.error) {
    message = typeof e.response.error === 'string' ? e.response.error : 'Processing failed.';
  }
  // ... more fallbacks
  
  // Update job with error
  updateJobLocal(jobId, { status: 'failed', error: message });
  await updateJobRow(jobId, { status: 'failed', error: message, progress: 100, ... });
  
  // Update document status to failed
  await supabase
    .from('au_documents')
    .update({ status: 'failed', error: message })
    .eq('id', job.document_id)
    .eq('user_id', user.id);
  
  await refreshJobs();
}
```

### `src/components/upload/upload-center.tsx`

**Line 345:** Fallback error display
```typescript
{job.status === 'failed' && (
  <div className="mt-1 text-sm text-destructive">
    {job.error || 'Processing failed. Check logs for details.'}
  </div>
)}
```

## Expected Behavior After Fix

### When Upload Succeeds:
1. ✅ Upload reaches 100%
2. ✅ Status changes to "processing"
3. ✅ Status changes to "done"
4. ✅ Document appears in collections (status = "completed")

### When Processing Fails:
1. ✅ Upload reaches 100%
2. ✅ Status changes to "processing"
3. ✅ Status changes to "failed"
4. ✅ **Error message is displayed** (even if null, shows fallback)
5. ✅ Document status updated to "failed"
6. ✅ Document does NOT appear in collections (correct behavior - only completed docs show)

## Debugging Steps

If you still see "Failed" without error message:

1. **Check browser console:**
   - Look for `[upload-jobs] Processing failed for job...` logs
   - Check the full error object logged

2. **Check Edge Function logs:**
   - Go to Supabase Dashboard → Edge Functions → `process-upload-job` → Logs
   - Look for error messages in the logs
   - Check for "Raw request body" log to see what was sent

3. **Check database:**
   ```sql
   -- Check job error field
   SELECT id, status, error, progress 
   FROM au_upload_jobs 
   WHERE id = '<job-id>';
   
   -- Check document status
   SELECT id, status, error 
   FROM au_documents 
   WHERE id = '<document-id>';
   ```

4. **Check network tab:**
   - Look for the Edge Function request
   - Check response body for error message
   - Check status code (400, 401, 500, etc.)

## Next Steps

1. **Test upload again** - Error message should now appear
2. **Check Edge Function logs** - Should see detailed error logs
3. **Verify document status** - Should be "failed" if processing failed
4. **Check collections** - Failed documents won't appear (this is correct)

## Why Document Doesn't Appear in Collections

**This is correct behavior:**
- Collections page filters by `status = 'completed'` (line 99 in documents/page.tsx)
- Failed documents have `status = 'failed'`
- Only successfully processed documents appear in collections

**To see failed documents:**
- They appear in the upload center with "Failed" status
- Error message explains why they failed
- User can retry the upload
