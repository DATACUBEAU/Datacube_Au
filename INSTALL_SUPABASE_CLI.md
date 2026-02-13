# Installing Supabase CLI on Windows

## ✅ Option 1: Use npx (No Installation Required)

You can use Supabase CLI via `npx` without installing it globally:

```powershell
# Check version (already works)
npx supabase --version

# Link to your project (one-time setup)
npx supabase link --project-ref YOUR_PROJECT_REF

# Apply migration
npx supabase db push --file backend/supabase/migrations/20240111000000_fix_rls_policies.sql
```

**Note:** You'll need your project reference ID from Supabase Dashboard → Settings → General

---

## Option 2: Install via Scoop (Recommended for Windows)

### Step 1: Install Scoop (if not installed)
```powershell
# Run in PowerShell (as Administrator)
Set-ExecutionPolicy RemoteSigned -Scope CurrentUser
irm get.scoop.sh | iex
```

### Step 2: Install Supabase CLI
```powershell
scoop bucket add supabase https://github.com/supabase/scoop-bucket.git
scoop install supabase
```

---

## Option 3: Install via Chocolatey (Alternative)

### Step 1: Install Chocolatey (if not installed)
```powershell
# Run in PowerShell (as Administrator)
Set-ExecutionPolicy Bypass -Scope Process -Force; [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072; iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))
```

### Step 2: Install Supabase CLI
```powershell
choco install supabase
```

---

## Option 4: Use Supabase Dashboard (Easiest - No CLI Needed)

**This is the simplest option for applying the migration:**

1. Go to your Supabase Dashboard
2. Navigate to **SQL Editor**
3. Copy the entire contents of `backend/supabase/migrations/20240111000000_fix_rls_policies.sql`
4. Paste into the SQL Editor
5. Click **Run** or press `Ctrl+Enter`
6. Verify all policies were created successfully

**No CLI installation required!**

---

## Quick Start: Apply Migration Now

Since you already have `npx` working, you can apply the migration:

```powershell
# First, link to your project (one-time)
npx supabase link --project-ref YOUR_PROJECT_REF

# Then apply the migration
npx supabase db push --file backend/supabase/migrations/20240111000000_fix_rls_policies.sql
```

**Or use the Dashboard method (Option 4) - it's faster and doesn't require linking!**

---

## Finding Your Project Reference

1. Go to Supabase Dashboard
2. Settings → General
3. Copy the **Reference ID** (looks like: `dhmukdeljiwvvwjdcxgn`)

---

## Troubleshooting

### If npx supabase link fails:
- Make sure you're in the project root directory
- Verify your Supabase project is active
- Check that you have the correct project reference ID

### If you get permission errors:
- Run PowerShell as Administrator
- Or use the Dashboard method (Option 4) - no permissions needed
