# Configuration Management System

This document describes the centralized configuration model for DataCube AU.

## Architecture

The platform follows a "Brain (Supabase) -> Muscle (VPS workers)" pattern. Runtime settings live in Supabase so Edge Functions and workers can fetch the same source of truth.

### Key Components

1. **Supabase Database (Source of Truth)**
   - `au_api_keys`: rotated provider keys (OpenRouter and others)
   - `au_models_registry`: chat/embedding model metadata
   - `au_rag_settings`: active defaults (embedding/chat models)

2. **ConfigService (`_shared/config_service.ts`)**
   - Shared config loader for Edge Functions
   - Lightweight cache to reduce repeated database reads
   - Helper methods for key retrieval and health checks

3. **Database RPCs**
   - `get_rotated_api_key(p_provider)`: atomic key rotation
   - `report_api_key_failure(p_key_value)`: mark failing keys inactive

## Operational Procedures

### Add a New API Key
1. Insert the key into `au_api_keys`.
2. Set `provider_type` correctly (for example `openrouter`).
3. The key enters rotation automatically.

### Update Models
1. Update `au_models_registry`.
2. Adjust model metadata (tier/context/status) as needed.
3. Services pick up changes after cache refresh.

## Security and Validation

- No hard-coded secrets in source control.
- CI checks should flag key-like patterns.
- Prefer encrypted storage (Supabase Vault where applicable).

## Obsolete Components

- `au_document_chunks.embedding`: deprecated in favor of `au_document_embeddings`.
- Legacy Firebase ingestion artifacts: removed in favor of VPS worker queueing.
