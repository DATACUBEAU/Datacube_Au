
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const migrationsDir = path.resolve(__dirname, 'supabase/migrations')
const skippedDir = path.resolve(__dirname, 'supabase/skipped_migrations')

if (!fs.existsSync(skippedDir)) {
  fs.mkdirSync(skippedDir)
}

const filesToSkip = [
  '20240523000001_fix_rls.sql',
  '20240523000002_fix_rpc.sql',
  '20240523000003_auto_cleanup.sql',
  '20260216132000_fix_drop_guest_columns.sql',
  '20260216133000_create_au_document_chunks.sql',
  '20260216134000_remove_remaining_guest_columns.sql',
  '20260217000000_fix_rls.sql',
  '20260224103000_payments_worker_owner_compat.sql',
  '20260302193000_tier_enforcement_and_quota_counters.sql',
  '20260305120000_add_gateway_subscriptions_table.sql'
]

console.log('Skipping old pending migrations...')

filesToSkip.forEach(file => {
  const src = path.join(migrationsDir, file)
  const dest = path.join(skippedDir, file)
  if (fs.existsSync(src)) {
    fs.renameSync(src, dest)
    console.log(`Moved ${file} to skipped_migrations`)
  } else {
    // console.log(`File ${file} not found, skipping move.`)
  }
})

console.log('Done.')
