
# Deploy Script for Datacube AU
# Run this from the project root

$ErrorActionPreference = "Stop"

Write-Host "Starting Deployment..." -ForegroundColor Green

# 1. Navigate to Supabase Directory
$SupabaseDir = "backend"
if (!(Test-Path $SupabaseDir)) {
    Write-Error "Could not find $SupabaseDir directory. Are you in the project root?"
    exit 1
}

Push-Location $SupabaseDir

# 2. Database Migration
Write-Host "`n[1/3] Applying Database Migrations..." -ForegroundColor Cyan
try {
    # Check if linked
    # supabase status # Optional check
    npx -y supabase@latest db push
    Write-Host "Database migrations applied successfully." -ForegroundColor Green
} catch {
    Write-Error "Failed to apply migrations. Please check your connection and try again."
    exit 1
}

# 3. Edge Functions Deployment
Write-Host "`n[2/3] Deploying Edge Functions..." -ForegroundColor Cyan

$Functions = @(
    "admin-handler",
    "au-chat",
    "firebase-auth-exchange",
    "get-firebase-token",
    "guest-session",
    "api-documents",
    "document-upload",
    "document-management",
    "log-event",
    "vector-search",
    "stripe-checkout",
    "stripe-portal",
    "stripe-webhook"
)

foreach ($Func in $Functions) {
    Write-Host "Deploying $Func..." -ForegroundColor Yellow
    try {
        # --no-verify-jwt is used because we handle auth internally or via custom middleware
        npx -y supabase@latest functions deploy $Func --no-verify-jwt
        Write-Host "$Func deployed." -ForegroundColor Green
    } catch {
        Write-Error "Failed to deploy $Func."
        # We continue to try others? Or stop? Let's stop to be safe.
        exit 1
    }
}

Pop-Location

Write-Host "`n[3/3] Deployment Complete!" -ForegroundColor Green
Write-Host "Please verify the deployment by checking the Supabase Dashboard." -ForegroundColor Gray
