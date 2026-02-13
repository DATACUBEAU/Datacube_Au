# Deployment Guide: Unified Identity & Backend Infrastructure

This guide details the steps to deploy the Datacube AU backend updates, including the new Unified Identity system (`au_users`), Smart Auth Switch (Firebase), and updated Edge Functions.

## Prerequisites

1.  **Supabase CLI**: Ensure you have the Supabase CLI installed and logged in.
    ```bash
    supabase login
    ```
2.  **Project Link**: Ensure your local project is linked to your remote Supabase project.
    ```bash
    cd backend/supabase
    supabase link --project-ref <your-project-ref>
    ```
3.  **Environment Secrets**: Set the following secrets in your Supabase project (Dashboard > Settings > API > Edge Functions or via CLI):
    ```bash
    supabase secrets set APP_SECRET="your-strong-random-secret"
    supabase secrets set NEXT_PUBLIC_FIREBASE_PROJECT_ID="your-firebase-project-id"
    supabase secrets set SUPABASE_BUCKET="documents"
    ```

## Deployment Steps

You can use the provided `deploy.ps1` script or run the commands manually.

### Option 1: Automated Script (PowerShell)

Run the deployment script from the project root:

```powershell
./deploy.ps1
```

### Option 2: Manual Deployment

1.  **Database Migrations**:
    Apply the database changes (including `20260205000000_unified_identity.sql`).

    ```bash
    cd backend/supabase
    supabase db push
    ```

2.  **Deploy Edge Functions**:
    Deploy the core functions.

    ```bash
    # From backend/supabase
    supabase functions deploy firebase-auth-exchange --no-verify-jwt
    supabase functions deploy api-documents --no-verify-jwt
    supabase functions deploy document-upload --no-verify-jwt
    supabase functions deploy document-management --no-verify-jwt
    supabase functions deploy log-event --no-verify-jwt
    supabase functions deploy vector-search --no-verify-jwt
    ```
    *Note: `--no-verify-jwt` is used because these functions handle their own auth verification (Supabase Auth or App Session).*

## Verification

1.  **Check Tables**: Go to Supabase Dashboard > Table Editor.
    *   Verify `au_users` and `au_user_profiles` exist.
    *   Verify `au_documents` has the `owner_id` column.
2.  **Check Functions**: Go to Supabase Dashboard > Edge Functions.
    *   Ensure all functions listed above are "Healthy".
3.  **Frontend Test**:
    *   Login with Google.
    *   Check the Network tab for a call to `firebase-auth-exchange`.
    *   Verify you receive a token and can load the dashboard.

## Rollback Procedure

If issues occur:

1.  **Revert Database**:
    If the migration fails or causes issues, you can rollback using the Supabase Dashboard (Point-in-Time Recovery) or by manually reverting the schema changes via SQL Editor.
    *   *Emergency Revert SQL*: `DROP TABLE au_app_sessions; DROP TABLE au_user_profiles; DROP TABLE au_users;` (Be careful with data loss!)

2.  **Revert Functions**:
    Redeploy the previous versions of the functions or use the Dashboard to rollback to a previous deployment.
