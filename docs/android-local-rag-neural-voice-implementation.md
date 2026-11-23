# DataCube AU — Offline Android intelligence execution plan

**Baseline**: `feat/android-compact-settings-model-setup` (PR #49), based on the current in-flight authentication PR #48. Payments are deferred in issue #50.

## Non-negotiable product decisions

- Android is the execution environment for document extraction, embeddings, vector retrieval, generation, diagram layout, and offline narration.
- Supabase + website remain the control plane for login, billing, quotas, and account entitlements. No document contents or local prompts go to a cloud LLM without a separate future opt-in product decision.
- Users may skip setup; no accidental installation or heavyweight model loading on first paint.
- No invented citations, page numbers, performance benchmarks, model sizes, or compatibility guarantees.
- Models must be properly licensed, packaged for the chosen Android runtime, verified against trusted hashes, and marked ready only after a smoke test.
- Keep DataCube AU's black/white/blue design. No permanent bottom navigation.

## Ordered implementation with exit gates

### Phase 0 — Preserve stable baseline

- Ensure PR #48 auth and PR #49 UI are verified before stacking new work on main.
- Re-run app build, lint, unit tests, emulator UI tests, and at least one physical Android device test.
- Do not merge a failed CI run or a partially connected inference adapter.

### Phase 1 — Retrieval groundwork and voice UX (this PR)

- Deterministic page-aware document chunks with bounded overlap.
- Local BM25 ranking as an actual keyword retrieval baseline in document AU Chat.
- Add tests for page references, chunk boundaries, and relevance.
- Let users choose **installed offline** Android voices, preview, speed, and pitch; persist choices on-device.
- No vector search or neural voice claims yet.

**Exit gate**: CI green. Document AU Chat shows source-grounded BM25 matches; Podcast can choose among locally installed voices and does not invoke network-required voices.

### Phase 2 — Model download manager

- Curated manifest: model ID, role (generation/embedding/voice), engine, ABI/backend compatibility, device requirements, direct source, license and acceptance requirements, file size, SHA-256, expected files and model version.
- Support free public downloads and gated Hugging Face model access only through explicit user consent and a supported credential flow; never embed private tokens in the APK.
- Transfer with resumable Range/ETag support when server allows; background execution and meaningful notifications with pause/cancel/retry states.
- Check required free storage *plus staging/rollback headroom* before downloading.
- Stream to private staging, verify trusted SHA-256 and expected format, atomic install, validate loading, then publish active model. Delete stale partials safely.
- Respect metered connection, low battery, thermal state, and the user's explicit download choice.
- Integrate download state into Settings > Models, with uninstall and backup/restore conflict UI.

**Exit gate**: cancellation, relaunch/resume, interrupted network, insufficient space, incorrect hash, and license gating tests pass on physical devices.

### Phase 3 — Actual embeddings

- Pin a verified Android LiteRT embedding runtime and compatible EmbeddingGemma model artifact. Do not treat model file import as activation.
- Include an embedding provider interface and a model-versioned vector schema (document ID, page number, chunk ordinal, source hash, embedding dimension, vector bytes).
- Build an incremental background index: extracted text -> chunker -> embedding inference -> atomic vector writes.
- Re-index when source text hash or embedder version changes. Removing a document deletes its vectors. Export/restore model files without misrepresenting associated vectors as portable.
- Benchmark loading, indexing throughput, recall, RAM, storage, CPU/GPU/thermal; fall back to BM25 on errors.

**Exit gate**: verified real embedding tensors, deterministic source IDs, semantic search demonstration with source page citations and no network calls.

### Phase 4 — Local generation and RAG

- Pin a compatible quantized Gemma LiteRT-LM artifact and verify runtime on representative Android hardware.
- Introduce a local inference interface, generation controls, context limits, cancellation, streaming, and model load/unload management.
- Retrieve using BM25 + vectors (reciprocal rank fusion or another tested fusion), show exact supporting snippets and pages.
- Optional agentic retries/self-critique only on capable devices; defaults are bounded for battery and speed.

**Exit gate**: offline answers from real local model, source-grounded references, repeatable no-network integration tests and memory budgets.

### Phase 5 — Smart Note diagrams

- Typed graph schema with node IDs, edges, template/layout, icon keys, source IDs/pages, confidence/evidence pointers and data validation.
- Compose diagram renderer: accessible nodes, branches, zoom/pan, real source evidence and page links.
- Static-looking polished cached renders generated from dynamically retrieved local content.
- PDF figures/formulas when source supports extraction; do not hallucinate a source image.
- Safe deterministic fallback if model output cannot be parsed, verified or rendered.

**Exit gate**: snapshot/UI tests, meaningful source taps and robust layouts at small widths.

### Phase 6 — Neural offline voice packs

- Integrate one independently reviewed Android-compatible sherpa-onnx TTS backend, beginning with a licensed Kokoro-style multi-voice pack if physical-device performance permits.
- Share the model manifest/download/cache lifecycle from Phase 2. Voice selection includes installed neural voices and installed offline Android fallback voices only.
- Stream or segment speech off the UI thread; expose voice samples, rate, cancel, chapter controls, storage size, and errors.
- Consider Piper/VITS small packs for low-RAM devices after testing; do not ship huge default assets.

**Exit gate**: voice switching, interrupt/stop, offline playback, lifecycle, battery and long-document tests pass on multiple devices.

### Phase 7 — Mobile quality gates

- Measure startup, first-frame, navigation, IME, scroll jank, background resumability, large PDFs, OOM risk, battery drain, storage, and cold model loading.
- Validate dark/light, talkback, touch targets, rotations, and Android versions.
- Finalize product subscription/entitlement semantics only after supported offline features and limits are measured.

### Phase 8 — Payment (LAST)

- Follow deferred issue #50: browser website checkout, signed server-side provider event handling, canonical subscription enforcement, and Android entitlement refresh.
- Do not grant paid access from browser return parameters or unverified client state.

## Runtime roles

| Role | Initial candidates | Rule |
| --- | --- | --- |
| Text generation | Gemma quantized LiteRT-LM | Device-verified; other families via curated adapter later |
| Document embeddings | EmbeddingGemma LiteRT | One active index per embedding model version |
| Keyword search | BM25 locally | Always available without an embedding model |
| Neural speech | sherpa-onnx + licensed Kokoro pack | Optional download; offline Android TTS fallback |
| Persistent document metadata | Room | Source IDs, work state and migration tests |

## Honest status tracking

- **Implemented before this PR**: native document extraction, manual model import, backup ZIP, on-device lexical search.
- **Implemented in this PR**: page-aware chunking, BM25 baseline, selectable installed offline voices, device-local voice preferences.
- **Not implemented in this PR**: on-device embeddings, vector index, background model downloader, native LLM inference, neural Kokoro playback, graphical Smart Note renderer.
