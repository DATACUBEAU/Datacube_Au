
$Url = "https://dhmukdeljiwvvwjdcxgn.supabase.co"
$ServiceKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRobXVrZGVsaml3dnZ3amRjeGduIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTIwNjAyOCwiZXhwIjoyMDgwNzgyMDI4fQ.3lrr0S4UH-9mccuIZAxn1TH82d-SezY19ny8OTaiS2o"
$Headers = @{
    "apikey" = $ServiceKey
    "Authorization" = "Bearer $ServiceKey"
    "Content-Type" = "application/json"
    "Prefer" = "return=representation"
}

Write-Host "--- 1. Creating Test Document ---"
$DocId = [Guid]::NewGuid().ToString()
$UserId = [Guid]::NewGuid().ToString() # Fake user ID, might work if RLS disabled or using service role
$DocBody = @{
    id = $DocId
    user_id = $UserId
    file_name = "test_trigger_verification.txt"
    file_path = "test/$DocId/file.txt"
    document_type = "main_textbook"
    status = "uploading"
} | ConvertTo-Json

try {
    $DocResp = Invoke-RestMethod -Uri "$Url/rest/v1/au_documents" -Method Post -Headers $Headers -Body $DocBody
    Write-Host "Document Created: $($DocResp.id)"
} catch {
    Write-Error "Failed to create document: $_"
    exit
}

Write-Host "`n--- 2. Creating Test Job (Status=Queued) ---"
$JobId = [Guid]::NewGuid().ToString()
$JobBody = @{
    id = $JobId
    document_id = $DocId
    user_id = $UserId
    file_name = "test_trigger_verification.txt"
    file_size_bytes = 123
    bucket = "documents"
    object_path = "test/$DocId/file.txt"
    status = "queued"
} | ConvertTo-Json

try {
    $JobResp = Invoke-RestMethod -Uri "$Url/rest/v1/au_upload_jobs" -Method Post -Headers $Headers -Body $JobBody
    Write-Host "Job Created: $($JobResp.id)"
} catch {
    Write-Error "Failed to create job: $_"
    exit
}

Write-Host "`n--- 3. Waiting for Trigger (2s) ---"
Start-Sleep -Seconds 2

Write-Host "`n--- 4. Checking au_debug_logs ---"
try {
    $Logs = Invoke-RestMethod -Uri "$Url/rest/v1/au_debug_logs?select=*&order=created_at.desc&limit=5" -Method Get -Headers $Headers
    $Logs | Format-Table -Property component, message, created_at -AutoSize
    
    $Found = $Logs | Where-Object { $_.details -match $JobId }
    if ($Found) {
        Write-Host "SUCCESS: Found log entry for Job $JobId"
    } else {
        Write-Warning "FAILURE: No log entry found for Job $JobId. Trigger might be missing."
    }
} catch {
    Write-Error "Failed to fetch logs: $_"
}

Write-Host "`n--- 5. Cleaning Up ---"
try {
    Invoke-RestMethod -Uri "$Url/rest/v1/au_documents?id=eq.$DocId" -Method Delete -Headers $Headers | Out-Null
    Write-Host "Cleanup complete."
} catch {
    Write-Warning "Cleanup failed."
}
