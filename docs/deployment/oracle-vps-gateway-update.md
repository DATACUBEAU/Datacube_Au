# Oracle VPS Gateway Update

Last updated: 2026-07-28

Use this after the code and Supabase migration are deployed. Do not paste secrets into shell history. Store secret values in your deployment secret manager, PM2 ecosystem file outside git, systemd environment file outside git, or Docker/Compose secret environment that is not committed.

## A. Files And Services Affected

| Item | Must update | Notes |
|---|---:|---|
| `vps-ai-gateway` | Yes | Deploy TypeScript gateway changes for ticket verification, CORS, RAG filters, provider sanitization, limits, and logging. |
| Frontend deployment | Yes | Deploy `/api/au/vps-ticket`, admin credential masking, PWA/offline safety, and prompt-starter document scoping. |
| RAG worker | Verify | Worker embedding model must remain compatible with gateway retrieval: `AllMiniLML6V2` unless both sides are intentionally changed together. |
| Environment variables | Yes | Add/check required names below on both frontend server and Oracle VPS. |
| Nginx/reverse proxy | Verify | Ensure only intended gateway domain/path proxies to the gateway port over HTTPS. |
| PM2/systemd/Docker service | Yes | Restart the gateway after code/env updates. |
| Firewall/security list | Verify | OCI ingress should allow only HTTPS/SSH and the private gateway port if required by reverse proxy topology. |
| Qdrant config | Verify | `QDRANT_URL` should use HTTPS in production unless Qdrant is private loopback/VPN-only. |
| Supabase keys/config | Yes | Rotate exposed historical keys and keep service-role keys server-only. |

## B. Required Oracle VPS Env Vars

Required or commonly used on the Oracle VPS gateway:

```text
NODE_ENV
PORT
HOST
VPS_SHARED_SECRET
ALLOWED_ORIGINS
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
SUPABASE_ANON_KEY
QDRANT_URL
QDRANT_API_KEY
QDRANT_COLLECTION
QDRANT_TIMEOUT_MS
OPENAI_API_KEY
OPENROUTER_API_KEY
ANTHROPIC_API_KEY
AI_PROVIDER_TIMEOUT_MS
AI_MAX_OUTPUT_TOKENS
AI_MAX_CONTEXT_CHARS
AI_MAX_HISTORY_CHARS
AI_MAX_MESSAGE_CHARS
AI_MAX_PAST_QUESTION_CONTEXT_CHARS
RATE_LIMIT_MAX_PER_MINUTE
DCAU_ALLOW_INSECURE_DEV_VPS_SECRET
```

Production requirements:

- `NODE_ENV` must be `production`.
- `VPS_SHARED_SECRET` must match the frontend/Next.js server env exactly.
- `ALLOWED_ORIGINS` must be an explicit comma-separated allowlist, never `*`.
- `QDRANT_URL` should be HTTPS in production. Loopback/private network URLs are acceptable only if Qdrant is not publicly reachable.
- No provider key or Supabase service-role key may be defined with `NEXT_PUBLIC_*`.

## C. Oracle VPS Update Commands

PM2:

```bash
cd /path/to/Datacube-Au
git pull origin main
cd vps-ai-gateway
npm ci
npm run build
pm2 restart vps-ai-gateway
pm2 logs vps-ai-gateway
```

systemd:

```bash
cd /path/to/Datacube-Au
git pull origin main
cd vps-ai-gateway
npm ci
npm run build
sudo systemctl restart vps-ai-gateway
sudo journalctl -u vps-ai-gateway -f
```

Docker:

```bash
cd /path/to/Datacube-Au
git pull origin main
docker compose build vps-ai-gateway
docker compose up -d vps-ai-gateway
docker logs -f vps-ai-gateway
```

Frontend deployment:

```bash
cd /path/to/Datacube-Au
git pull origin main
npm ci
npm run build
```

Use your actual deployment command after the build step.

## D. Oracle Cloud Networking Checklist

| Check | Required result |
|---|---|
| Gateway port | The local gateway listens on `PORT`; do not expose it directly if Nginx terminates HTTPS. |
| Nginx reverse proxy | Public domain/path forwards only to the gateway service. |
| HTTPS certificate | Valid certificate for the gateway domain. |
| OCI Security List / NSG | Inbound allows only needed ports, typically 443 and restricted SSH. |
| Health endpoint | `/health` returns non-secret status only. |
| Frontend origin | Frontend production domain is present in `ALLOWED_ORIGINS`. |
| Public generation endpoints | `/chat/*` and `/generate/*` return 401 without a valid VPS ticket. |
| Qdrant | Not publicly reachable without auth; prefer HTTPS/private network. |

## E. Post-Update Live Tests

Run these after restarting services:

- `GET /health` returns healthy metadata with no secrets.
- AU Chat succeeds with a valid ticket.
- Global Chat succeeds with a valid ticket.
- Document upload creates a worker job.
- Qdrant document question returns cited chunks from the correct document.
- Knowledge Hub uses bounded document retrieval.
- Practice Exam uses bounded document retrieval.
- Exam Prediction uses bounded document retrieval.
- Prompt Starters use bounded document retrieval.
- Invalid, expired, malformed, and tampered tickets return 401.
- A ticket for one route is rejected on a different route.
- Cross-user retrieval attempts return no chunks.
- Gateway logs do not show Authorization headers, tickets, provider keys, Supabase keys, Qdrant keys, or raw provider responses.

## Oracle VPS Secret And API Key Checklist

Store these only in server-side environment/secrets storage:

```text
VPS_SHARED_SECRET
SUPABASE_SERVICE_ROLE_KEY
QDRANT_API_KEY
OPENAI_API_KEY
OPENROUTER_API_KEY
ANTHROPIC_API_KEY
PAYSTACK_SECRET_KEY
PAYSTACK_SECRET
FLUTTERWAVE_SECRET_KEY
FLUTTERWAVE_WEBHOOK_SECRET_HASH
```

Values that must match frontend/server env:

```text
VPS_SHARED_SECRET
SUPABASE_URL
QDRANT_COLLECTION
```

Values that must never be in frontend `NEXT_PUBLIC_*`:

```text
SUPABASE_SERVICE_ROLE_KEY
QDRANT_API_KEY
OPENAI_API_KEY
OPENROUTER_API_KEY
ANTHROPIC_API_KEY
PAYSTACK_SECRET_KEY
PAYSTACK_SECRET
FLUTTERWAVE_SECRET_KEY
FLUTTERWAVE_WEBHOOK_SECRET_HASH
VPS_SHARED_SECRET
```

Restart after env changes using your supervisor:

```bash
pm2 restart vps-ai-gateway
```

```bash
sudo systemctl restart vps-ai-gateway
```

```bash
docker compose up -d vps-ai-gateway
```

Verify logs without printing secrets:

```bash
pm2 logs vps-ai-gateway
```

```bash
sudo journalctl -u vps-ai-gateway -f
```

```bash
docker logs -f vps-ai-gateway
```

Look for secret-shaped labels only, not values: `Authorization`, `Bearer`, provider key names, Supabase key names, Qdrant key names, and raw provider response bodies. The gateway should log configuration presence as booleans/counts only.

Verify public endpoints do not expose config:

```bash
curl -i https://YOUR_GATEWAY_DOMAIN/health
curl -i https://YOUR_GATEWAY_DOMAIN/chat/au-chat
curl -i https://YOUR_GATEWAY_DOMAIN/generate/practice-exam
```

Expected result: health is non-secret; generation/chat routes reject without a valid ticket.
