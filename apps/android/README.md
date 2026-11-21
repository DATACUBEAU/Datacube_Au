# DataCube AU — Native Android

Native Kotlin + Jetpack Compose application. The Flutter project in `apps/mobile` remains a legacy reference and is not the active customer app.

## Implemented native slices

- Five-item application navigation: Home, Documents, Study, AU Chat and Profile.
- Compose Material 3 theme tokens and the black/white/blue visual system.
- Home dashboard with active documents, recent files and document-scoped quick ask.
- Multi-file Android Storage Access Framework import into app-private storage.
- Room-backed document metadata, collections and collection membership with versioned migrations.
- Durable Room import/extraction jobs scheduled by WorkManager; recovery is attempted at app startup.
- Streaming SHA-256 integrity verification for imported files.
- Local UTF-8 text extraction for TXT and Markdown files (up to 20 MB) with BOM/newline handling.
- Local PDF text extraction using PDFium, preserving page boundaries for citations (up to 100 MB).
- Extracted text is written atomically to app-private storage, not to Room or cloud storage.
- Document workspace with AU Chat, Smart Note, Prediction, Practice and Podcast tabs.
- AU Chat currently performs local lexical matching against extracted text and shows page references; it is not yet semantic RAG or generative AI.
- Smart Note currently builds extractive notes and a heuristic concept map from detected headings and recurring terms.
- Prediction currently builds a revision outline and prompts from detected topics; it does not provide probability scores or claim to forecast an exam.
- Practice currently provides configurable self-study prompts, answer capture and source-passage review; it does not automatically grade answers.
- Podcast currently uses Android TextToSpeech to narrate extracted passages; it does not create or upload an audio file.
- Empty, loading and extraction error states are surfaced in the relevant document tools.
- Compose UI tests cover Home, Documents, collection workspace and document study-tool interactions.

## Local-first data boundary

Imported document bytes and extracted text remain inside app-private storage. Room stores local metadata and job state. The current study helpers operate on the locally extracted preview; they do not upload source text, prompts or generated audio. Do not describe these deterministic local helpers as the production AU AI/RAG runtime.

## Local AI model backup and restore

- Installed model artifacts use the app-private location `files/models/installed/<model-id>/`.
- Temporary downloads must stay outside that installed directory. The new `ModelRegistry` provides staging directories and commits only complete artifact sets after size/SHA-256 verification. Only complete model folders in the installed directory are exported.
- Profile settings provides **Export model backup** and **Restore from backup** actions, with visible phase/file/byte progress and a cancellation control.
- Export creates one portable ZIP file through Android's Storage Access Framework. The user chooses the destination, including Documents, an SD card, USB storage or a connected cloud document provider.
- The archive includes every installed model file plus a versioned archive manifest containing file sizes and SHA-256 checksums. Registry-installed models also carry `.datacube-model.properties` with the model ID, source repository/revision, licence, task, runtime, format, quantization, device requirements and declared artifact hashes. Partial `.part` and `.tmp` files are excluded.
- Restore verifies the manifest, paths, file sizes and checksums before installing any model. Work runs off the main thread, checks cancellation during file streaming, and removes incomplete export documents where the storage provider permits it. It rejects unsafe paths, duplicate entries, incomplete archives and attempts to overwrite an installed model.
- Model data is copied into app-private installed storage after verification; the exported ZIP remains in the user-selected external location and can be selected again after reinstalling the app.
- This backup foundation does not yet implement model discovery, Hugging Face downloads, model inference, or model activation. The future model download manager must install into the documented directory and write only complete model folders there.

## Target architecture

Kotlin, Jetpack Compose, MVVM, Coroutines/Flow, Room, WorkManager, Android Keystore, local-first document intelligence and provider-independent DIMR. Cloud inference should remain optional and consent-based.

## Build and verification

The GitHub Actions workflow uses JDK 21 and Android SDK 35. From this directory:

```sh
./gradlew :app:testDebugUnitTest
./gradlew :app:assembleDebug
./gradlew :app:lintDebug
./gradlew :app:connectedDebugAndroidTest
./gradlew :app:bundleRelease
```

The CI release bundle is an unsigned preflight artifact, not a Play Store-ready signed release.

## Remaining migration and product gaps

- DOCX/RTF parsing and OCR for scanned PDFs.
- Chunking, embeddings, local vector indexing and semantic retrieval.
- Production RAG chat and model gateway integration for document-aware AI.
- AI-generated Smart Notes, actual exam prediction and generated/streamable podcast audio.
- Automatic practice grading and durable study-session history.
- Complete entitlement/billing enforcement and production app configuration.
- Additional device testing across Android versions, screen sizes, accessibility settings and real hardware.

Authentication, import and local processing have native implementations, but production readiness still requires the full CI gate, real-device verification and review of backend/entitlement boundaries.
