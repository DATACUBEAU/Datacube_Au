# DataCube AU — Native Android

Kotlin + Jetpack Compose Android application. The Flutter project in `apps/mobile` remains a reference until native feature parity is implemented and verified.

## Implemented native slices

- Five-tab application shell: Home, Documents, Study, AU Chat, Profile.
- Compose Material 3 UI.
- Room-backed document metadata and versioned database migration.
- Android Storage Access Framework import into app-private storage.
- PDF, DOCX, TXT, RTF and Markdown import selection with a 100 MB per-file limit.
- A durable Room job is committed in the same transaction as each imported document.
- WorkManager receives only the durable job ID; its worker reloads the document reference from Room.
- Local document integrity verification using streaming SHA-256; the fingerprint is stored as metadata.
- Unique work, retry/backoff, recoverable queued/running jobs and generic completion notifications.
- No document bytes, extracted text, prompts or embeddings are sent to a server by this pipeline.

## Target architecture

Kotlin, Compose, MVVM, Coroutines/Flow, Room, WorkManager, Android Keystore, local-first document intelligence and provider-independent DIMR. Cloud inference remains optional and consent-based.

## Build

JDK 17 + Android SDK 35. From this directory:

```sh
gradle :app:assembleDebug
```

## Not yet migrated

Supabase authentication/session handling, secure browser sign-in callbacks, document text extraction/OCR, chunking, embeddings, local vector search, model discovery/runtime, RAG chat, study generation, billing/entitlements, rewarded ads, analytics and production hardening.

The SHA-256 worker verifies that a copied file remains readable and stable; it is not document extraction or AI indexing. Notification permission is declared but is not requested automatically. This is still an incremental migration, not complete Flutter feature parity.
