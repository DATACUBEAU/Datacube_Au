-- Remove all legacy document-storage policies.
-- Buckets and their objects are scheduled for deletion through the Storage API.
drop policy if exists "Allow public uploads" on storage.objects;
drop policy if exists "Public Access to Documents" on storage.objects;
drop policy if exists "Users can delete their own documents (DataCube)" on storage.objects;
drop policy if exists "Users can update their own documents (DataCube)" on storage.objects;
drop policy if exists "Users can view their own documents (DataCube)" on storage.objects;
drop policy if exists "Users can upload their own documents (DataCube)" on storage.objects;
drop policy if exists "Users can insert own documents" on storage.objects;
drop policy if exists "Users can view own documents" on storage.objects;
