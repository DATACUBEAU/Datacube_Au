-- Fix legacy service-role policies that were accidentally scoped to PUBLIC.
-- RLS policies with TO public apply to anon and authenticated roles as well.
-- These tables must only be writable by trusted server-side functions.

drop policy if exists "Service role only billing events" on public.au_billing_events;
drop policy if exists "Service role only stripe events" on public.au_billing_events;
create policy "service_role_manage_billing_events"
  on public.au_billing_events
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists "Service role full access payments" on public.au_payments;
create policy "service_role_manage_payments"
  on public.au_payments
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists "Service role full access manual payments" on public.au_manual_payments;
create policy "service_role_manage_manual_payments"
  on public.au_manual_payments
  for all
  to service_role
  using (true)
  with check (true);

-- Service-role management for routing is explicit; model metadata remains publicly readable
-- through the existing SELECT policy.
drop policy if exists "Service role can manage model routing" on public.au_model_routing;
create policy "service_role_manage_model_routing"
  on public.au_model_routing
  for all
  to service_role
  using (true)
  with check (true);
