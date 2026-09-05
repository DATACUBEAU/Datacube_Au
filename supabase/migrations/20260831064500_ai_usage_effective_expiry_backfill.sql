-- Backfill durable reservation expiry for provider work accepted before lease refresh.
--
-- During rolling deployment, reservations can exist whose provider attempt started
-- under the bounded effective-lease implementation but before begin_ai_usage_reservation
-- began persisting that lease into expires_at. Finite-window admission reads expires_at
-- directly, while commit/cleanup use ai_usage_reservation_effective_expiry(...).
-- Normalize those still-reserved rows once so admission and settlement share the same
-- durable lease boundary. Future accepted attempts already refresh expires_at directly.

BEGIN;

UPDATE public.ai_usage_reservations AS r
SET expires_at = public.ai_usage_reservation_effective_expiry(
      r.expires_at,
      r.provider_started_at
    ),
    updated_at = clock_timestamp()
WHERE r.status = 'reserved'
  AND r.provider_started_at IS NOT NULL
  AND r.expires_at < public.ai_usage_reservation_effective_expiry(
        r.expires_at,
        r.provider_started_at
      );

COMMIT;
