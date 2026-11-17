# DataCube AU — Native Android
Kotlin + Jetpack Compose Android application. The Flutter project in apps/mobile remains a reference until native feature parity is implemented and verified.

## Implemented first native slice
- Five-tab application shell: Home, Documents, Study, AU Chat, Profile.
- Compose Material 3 UI.
- Room-backed document metadata.
- Android Storage Access Framework import.
- Files copied into app-private storage; document bytes are not uploaded.
- PDF, DOCX, TXT, RTF and Markdown import selection.
- 100 MB per-file limit.

## Target architecture
Kotlin, Compose, MVVM, Coroutines/Flow, Room, WorkManager, Android Keystore, local-first document intelligence and provider-independent DIMR. Cloud inference remains optional and consent-based.

## Build
JDK 17 + Android SDK 35. From this directory: gradle :app:assembleDebug

## Not yet migrated
Supabase authentication/session storage, document extraction/OCR, chunking, embeddings, local vector search, model discovery/runtime, chat, study generation, billing/entitlements, rewarded ads, telemetry and production hardening. This repository change is the first native implementation slice, not complete feature parity.
