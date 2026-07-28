$requiredEnv = @(
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY'
)

$missing = $requiredEnv | Where-Object { -not [Environment]::GetEnvironmentVariable($_) }

if ($missing.Count -gt 0) {
  Write-Error ("Missing required backend env vars: " + ($missing -join ', '))
  exit 1
}

Write-Output 'Trigger verification script is credential-safe. Implement local verification with env-provided credentials only.'
