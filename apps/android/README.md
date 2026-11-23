# DataCube AU — Native Android

Native Kotlin + Jetpack Compose application. The Flutter project in `apps/mobile` remains a legacy reference and is not the active customer app.

## Implemented native slices

- Floating sticky AU / Document navigation; document tools open inside their document workspace.
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
- AU Chat currently uses a page-aware local text chunker and BM25 keyword ranking against extracted text previews, showing page references; it is not yet semantic RAG or generative AU.
- Smart Note currently builds extractive notes and a heuristic concept map from detected headings and recurring terms.
- Prediction currently builds a revision outline and prompts from detected topics; it does not provide probability scores or claim to forecast an exam.
- Practice currently provides configurable self-study prompts, answer capture and source-passage review; it does not automatically grade answers.
- Podcast currently uses user-selectable installed **offline** Android voices, with voice preview, speed and pitch persisted on-device. It does not yet have a neural voice engine, create an audio file, or upload text/audio.
- Empty, loading and extraction error states are surfaced in the relevant document tools.
- Compose UI tests cover Home, Documents, collection workspace and document study-tool interactions.

## Local-first data boundary

Imported document bytes and extracted text remain inside app-private storage. Room stores local metadata and job state. The current study helpers operate on the locally extracted preview; they do not upload source text, prompts or generated audio. Do not describe these deterministic local helpers as the production AU AI/RAG runtime.

## Local AI model backup and restore

- Installed model artifacts use the app-private location `files/models/installed/<model-id>/`.
- Temporary downloads must stay outside that installed directory. Only complete model folders in the installed directory are exported.
- Settings > Backups provides **Export backup** and **Restore backup** actions.
- Export creates one portable ZIP file through Android's Storage Access Framework. The user chooses the destination, including Documents, an SD card, USB storage or a connected cloud document provider.
- The archive includes every installed model file plus a versioned manifest containing file sizes and SHA-256 checksums. Partial `.part` and `.tmp` files are excluded.
- Restore verifies the manifest, paths, file sizes and checksums before installing any model. It rejects unsafe paths, duplicate entries, incomplete archives and attempts to overwrite an installed model.
- Model data is copied into app-private installed storage after verification; the exported ZIP remains in the user-selected external location and can be selected again after reinstalling the app.
- Settings > Models lists publisher pages for EmbeddingGemma 300M and Gemma 4 E2B/E4B; the user may accept upstream terms, obtain compatible model bundles, and import files using Android's document picker. Import stages data outside the installed folder and commits complete model directories atomically. Hashes are recorded for local integrity, but there is no upstream checksum authenticity verification yet.\n- This is a model setup and import stage, not a native one-tap model downloader, embedder activation, vector index, or model inference runtime. Do not advertise local RAG as ready until those engines and integrity checks are integrated.

## Target architecture

Kotlin, Jetpack Compose, MVVM, Coroutines/Flow, Room, WorkManager, Android Keystore, local-first document intelligence and provider-independent DIMR. Cloud inference should remain optional and consent-based.

## Minimalist document-first navigation

- Home and Documents are accessed through the AU / Document selector at the top; the bottom tab bar is retired.
- Home keeps a source-grounded question composer above the system navigation area. Add/select a document before sending.
- AU Chat, Smart Note, Prediction, Practice and Podcast are views within an imported document's workspace, not separate top-level destinations.
- The Settings gear opens compact Settings, with display modes, Models, Backups, notifications opt-in and Profile. A first-login, opt-in device capability check reads memory and free storage only.
- During browser sign-in, the temporary device pairing code can be copied to the clipboard and pasted into the highlighted approval field on the website.

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
- Durable full-document indexing, embeddings, local vector indexing and semantic retrieval (a page-aware preview chunker and BM25 baseline now exist).
- Production RAG chat and model gateway integration for document-aware AI.
- AI-generated Smart Notes, actual exam prediction and generated/streamable podcast audio.
- Automatic practice grading and durable study-session history.
- Complete entitlement/billing enforcement and production app configuration.
- Additional device testing across Android versions, screen sizes, accessibility settings and real hardware.

Authentication, import and local processing have native implementations, but production readiness still requires the full CI gate, real-device verification and review of backend/entitlement boundaries.

## Active implementation roadmap

See `docs/android-local-rag-neural-voice-implementation.md` for the ordered offline model downloader, actual vector embedding, local LLM, Smart Note diagram and optional neural TTS integration plan. Payment remains deferred in issue #50.
