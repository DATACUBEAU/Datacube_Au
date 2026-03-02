# Datacube AU

Datacube AU is a comprehensive educational platform built with Next.js, designed to provide advanced document management, AI-powered study assistance, and exam preparation tools. The platform integrates with Supabase for backend services.

## 🚀 Features

-   **Smart Authentication**: Secure user authentication via Supabase Auth.
-   **Document Management**: robust system for uploading, organizing, and managing study materials.
-   **AI Assistant (RAG)**: Retrieval-Augmented Generation powered chat interface for querying documents and getting intelligent answers.
-   **Exam Tools**: Features for generating practice exams and predicting exam topics.
-   **PWA Support**: Fully functional Progressive Web App with offline capabilities.
-   **Responsive UI**: Modern, accessible interface built with Tailwind CSS and Shadcn UI.

## 🛠 Tech Stack

-   **Frontend**: [Next.js 14](https://nextjs.org/) (App Router), [React](https://react.dev/), [TypeScript](https://www.typescriptlang.org/)
-   **Styling**: [Tailwind CSS](https://tailwindcss.com/), [Shadcn UI](https://ui.shadcn.com/)
-   **Backend / Database**: [Supabase](https://supabase.com/) (PostgreSQL, Auth, Edge Functions, Storage)
-   **State Management**: React Context & Hooks
-   **Testing**: Playwright

## 📂 Project Structure

```
Datacube-Au/
├── public/                 # Static assets (images, icons, PWA files)
├── rag-worker/             # RAG (Retrieval-Augmented Generation) worker service
│   ├── src/                # Worker source code
│   └── ...
├── src/
│   ├── app/                # Next.js App Router pages and API routes
│   │   ├── api/            # Backend API endpoints (Next.js)
│   │   ├── dashboard/      # Main application dashboard
│   │   ├── login/          # Authentication pages
│   │   └── ...
│   ├── components/         # Reusable React components
│   │   ├── ui/             # UI primitives (buttons, inputs, etc.)
│   │   ├── providers/      # Context providers
│   │   └── ...
│   ├── hooks/              # Custom React hooks
│   ├── lib/                # Utility functions and API clients
│   │   ├── supabase-client/# Supabase configuration
│   │   └── ...
│   └── ...
├── tests/                  # End-to-end and integration tests
├── .env.local              # Local environment variables (gitignored)
├── next.config.ts          # Next.js configuration
├── package.json            # Project dependencies and scripts
├── tailwind.config.ts      # Tailwind CSS configuration
└── tsconfig.json           # TypeScript configuration
```

## 🏁 Getting Started

### Prerequisites

-   Node.js (v18 or higher recommended)
-   pnpm (recommended) or npm
-   Supabase project

### Installation

1.  **Clone the repository**
    ```bash
    git clone https://github.com/your-org/datacube-au.git
    cd datacube-au
    ```

2.  **Install dependencies**
    ```bash
    npm install
    # or
    pnpm install
    ```

3.  **Environment Setup**
    Create a `.env.local` file in the root directory and add your Supabase credentials:

    ```env
    # Supabase
    NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
    NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key

    ```

4.  **Run the development server**
    ```bash
    npm run dev
    # or
    pnpm dev
    ```

    Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## 📜 Scripts

-   `npm run dev`: Starts the development server.
-   `npm run build`: Builds the application for production.
-   `npm run start`: Starts the production server.
-   `npm run lint`: Runs ESLint to check for code quality issues.
-   `npm run test`: Runs the test suite.

## 🤝 Contributing

Contributions are welcome! Please follow these steps:

1.  Fork the project.
2.  Create your feature branch (`git checkout -b feature/AmazingFeature`).
3.  Commit your changes (`git commit -m 'Add some AmazingFeature'`).
4.  Push to the branch (`git push origin feature/AmazingFeature`).
5.  Open a Pull Request.

## 📄 License

[MIT](LICENSE)

## Billing And Entitlements Architecture

-   **Checkout lifecycle**:
    `POST /api/billing/checkout` creates a Paystack transaction (card subscription or pay-with-transfer one-time) and records a pending `billing_transactions` row with a unique reference.
-   **Webhook lifecycle**:
    `POST /api/billing/webhook` verifies `x-paystack-signature`, writes an idempotency record (`billing_webhook_events`), verifies transactions server-side, then updates `billing_transactions`, `billing_subscriptions`, and `entitlement_grants`.
-   **Entitlement lifecycle**:
    Pro access is derived from active `entitlement_grants` (and promo window where applicable). `entitlement_audit` records every grant/update/revocation transition.
-   **Promo Pro window**:
    Promo is treated as server truth and ends at **2026-04-02T00:00:00 Africa/Lagos** (`2026-04-01T23:00:00Z`). After this point, only active paid entitlement keeps Pro.
-   **Bypass prevention**:
    Client redirects/success pages do not grant value. Access is granted only after verified webhook + server verification and persisted entitlement rows.
-   **Reconciliation**:
    `POST /api/billing/reconcile` verifies stale pending transactions and revokes expired access paths. Run nightly via cron.

## Model Routing Architecture

-   Single routing source of truth: `selectProviderAndModel(...)` in [`src/lib/server/ai-routing.ts`](./src/lib/server/ai-routing.ts).
-   Flag behavior:
    - `model_routing.tier_split_enabled = false` => all users route to paid (`pro`) tier.
    - `model_routing.tier_split_enabled = true` => free users stay free tier, paid users stay pro tier.
-   Paid safety guard:
    pro routing blocks any model ending with `:free`.
-   Fallback policy:
    retry model/key candidates only within the selected tier; no cross-tier fallback.
-   Observability:
    structured server logs + `ai_routing_audit` table, with response debug headers (`x-au-model`, `x-au-service`, `x-au-tier`) in non-production/admin contexts.

## RAG Worker Transformers-Only Mode

-   Worker path: [`rag-worker/`](./rag-worker)
-   `TRANSFORMERS_FALLBACK_ENABLED=true` now forces **Transformers-first** embeddings and skips FastEmbed cache/init/download entirely.
-   Model env:
    - `TRANSFORMERS_EMBEDDING_MODEL` (default: `Xenova/all-MiniLM-L6-v2`)
    - `HF_CACHE_DIR` (recommended persistent volume path, e.g. `/app/local_cache/hf`)
    - `FASTEMBED_CACHE_DIR` (used only when transformers mode is disabled)
-   Startup safety:
    - worker fails fast if `TRANSFORMERS_FALLBACK_ENABLED=true` but `@huggingface/transformers` is missing.
-   Expected logs in transformers-only mode:
    - `Transformers-only embedder mode enabled; FastEmbed initialization skipped`
    - `Initializing Transformers fallback embedder`
    - completion record with `"embedder":"transformers"`
-   Smoke test:
    - `cd rag-worker && SMOKE_OWNER_ID=<existing_user_uuid> TRANSFORMERS_FALLBACK_ENABLED=true npm run smoke:transformers`

## Billing Test Checklist

1.  `tier_split_enabled=false`: free user chat routes to paid service/model (no `:free`).
2.  `tier_split_enabled=false`: pro user chat routes to paid service/model.
3.  `tier_split_enabled=false`: no request routes to `metadata.tier='free'` keys.
4.  `tier_split_enabled=true`: free user routes only to free-tier keys/models.
5.  `tier_split_enabled=true`: pro user routes only to pro-tier keys/models.
6.  `tier_split_enabled=true`: pro routing failure does not fall back to free.
7.  AI upstream 429 returns HTTP 429 to client with `Retry-After`.
8.  Chat UI shows rate-limit toast with retry action and cooldown.
9.  Card checkout success: webhook `charge.success` grants Pro entitlement.
10. Transfer checkout success: webhook `charge.success` grants one-time Pro (7/30 days).
11. Transfer flow is labeled one-time/manual renewal in UI.
12. Duplicate webhook delivery does not double-grant entitlement.
13. Failed charge events mark transaction failed and do not grant access.
14. `subscription.disable` / `subscription.not_renew` updates subscription status.
15. Expired entitlements are revoked by reconciliation job.
16. User redirected to success page without verified webhook remains Free.
17. Promo users see in-app Promo banner with April 2, 2026 Lagos end date.
18. After promo end (`2026-04-02 Africa/Lagos`), users without paid entitlement are downgraded automatically.
19. `/api/billing/status` reflects server truth for entitlement and subscription.
20. `/api/billing/cancel` sets non-renewing state and disables auto-renew.

## Free vs Pro Tier System

-   Single source of truth policy:
    - `src/lib/tier/policy.ts`
    - Defines tiers (`FREE`, `PRO`, `PROMO_PRO`), feature access map, quota map, and hard constraints.
-   Shared backend guard:
    - `src/lib/server/tier-enforcement.ts`
    - Used by `src/app/api/proxy/[functionName]/route.ts` before forwarding any edge-function call.
-   Structured limit/pro-required payloads:
    - `PRO_REQUIRED` (HTTP 402)
    - `LIMIT_REACHED` (HTTP 429)
    - Includes upgrade CTA payload (`/pricing?source=...`).
-   Atomic quota tracking:
    - Migration: `supabase/migrations/20260302193000_tier_enforcement_and_quota_counters.sql`
    - Tables: `quota_policies`, `quota_usage_counters`, `limit_events`
    - RPCs: `consume_quota_counter`, `consume_document_upload_quota`
-   Hard constraints implemented:
    - Upload file size: 50MB default for everyone.
    - `upload_100mb` flag ON => 100MB for everyone.
    - Lifetime uploaded documents: Free 4, Pro 10.
-   Capability discovery surface:
    - API: `GET /api/tier/capability-matrix`
    - UI: `/pricing` auto-renders feature matrix and quota table from shared policy.

## Tier QA Checklist

1.  Free user calls `/api/proxy/global-chat` and receives `PRO_REQUIRED` (402).
2.  Free user calls `/api/proxy/prediction-engine` and receives `PRO_REQUIRED` (402).
3.  Free user calls `/api/proxy/exam-generator` and receives `PRO_REQUIRED` (402).
4.  Pro user can call `global-chat`, `prediction-engine`, and `exam-generator`.
5.  Free user chat calls consume `messages_per_day` quota atomically.
6.  Concurrent free chat requests cannot bypass daily limits.
7.  `generate-knowledge` consumes `knowledge_generations_per_day`.
8.  `generate-prompt-starters` consumes `prompt_starters_per_day`.
9.  Upload initiate/complete rejects files larger than 50MB when `upload_100mb=false`.
10. Upload initiate/complete allows up to 100MB when `upload_100mb=true`.
11. Free user hits lifetime document quota at 4 uploads and receives `LIMIT_REACHED`.
12. Pro user hits lifetime document quota at 10 uploads and receives `LIMIT_REACHED`.
13. Repeated `complete` for the same document does not double-consume upload quota.
14. Limit hits insert rows into `limit_events` with `user_id`, `key`, `route`, `tier`.
15. Upgrade modal opens from structured `PRO_REQUIRED` payload.
16. Upgrade modal opens from structured `LIMIT_REACHED` payload.
17. `/pricing` table reflects policy changes from `src/lib/tier/policy.ts` automatically.
18. Settings page shows server-truth plan status from `/api/billing/status`.
