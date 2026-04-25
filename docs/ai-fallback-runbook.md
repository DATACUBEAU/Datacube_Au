# AI Routing Fallback Runbook

## What changed

- OpenRouter endpoint configuration is now explicit and environment-driven:
  - `OPENROUTER_BASE_URL` (default: `https://openrouter.ai/api/v1`)
  - `OPENROUTER_CHAT_COMPLETIONS_PATH` (default: `/chat/completions`)
  - `OPENROUTER_EMBEDDINGS_PATH` (default: `/embeddings`)
  - `OPENROUTER_MODELS_PATH` (default: `/models/user`)
- All OpenRouter chat/embedding calls now include structured diagnostics on failure:
  - URL, method, sanitized headers, request body preview, status, response preview.
- Retries are automatic for transient errors:
  - `429`, `502`, `503`, `504`
  - transient `404` (route/network style, not model-not-found)
- Model-not-found `404` now triggers model-pool refresh from OpenRouter `/models/user`.
- If policy models are unavailable, an emergency model pool is selected from user-available models.
- Optional fallback provider (OpenAI-compatible) is supported when OpenRouter is exhausted.

## Fallback provider config

- `AI_FALLBACK_ENABLED` (`true` by default)
- `FALLBACK_OPENAI_API_KEY` (or `OPENAI_API_KEY`)
- `FALLBACK_OPENAI_BASE_URL` (or `OPENAI_BASE_URL`, default `https://api.openai.com/v1`)
- `FALLBACK_OPENAI_MODEL` (default `gpt-4o-mini`)

If fallback is disabled or missing keys, the API returns a structured `503` with actionable details.

## Retry config

- `OPENROUTER_RETRY_ATTEMPTS` (default `2`)
- `OPENROUTER_RETRY_BASE_MS` (default `400`)
- `OPENROUTER_MODELS_CACHE_TTL_MS` (default `300000`)
- `OPENROUTER_EMERGENCY_MODELS` (optional comma-separated preferred emergency IDs)

## Monitoring / alerting signal

- On full exhaustion, the backend writes an `au_debug_logs` entry:
  - `source: ai-routing`
  - `message: All AI models are currently unavailable`
  - includes tried models, last status/details, emergency/fallback usage.

Hook your alerting system (Sentry/Datadog/log forwarder) to this exact message.

## Smoke test after deploy

Run:

```bash
AUTH_BEARER_TOKEN=<token> BASE_URL=https://datacube-au.vercel.app npm run test:ai-endpoints-smoke
```

The smoke test fails if any AI endpoint returns `404`.
