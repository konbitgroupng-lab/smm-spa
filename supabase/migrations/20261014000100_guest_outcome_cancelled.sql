-- Phase 5e integration fix: what a guest is told about a cancelled booking.
--
-- Staff can cancel a paid booking (Phase 5b). The guest's confirmation page
-- asks for the payment's outcome, which reported "confirmed" whenever a
-- payment had a booking, so a cancelled booking still showed as confirmed.
-- The outcome now reports "cancelled" when the payment's booking has been
-- cancelled. Nothing else changes: payments and appointments are not touched.
--
-- (replaces the version in 20261003000100; only the [5e] line differs)
create or replace function private.payment_outcome(p_payment public.payments)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'status', case
      when p_payment.status in ('succeeded', 'partially_refunded', 'refunded') and p_payment.appointment_id is not null
       and exists (select 1 from public.appointments a where a.id = p_payment.appointment_id and a.status = 'cancelled') then 'cancelled' -- [5e]
      when p_payment.status in ('succeeded', 'partially_refunded', 'refunded') and p_payment.appointment_id is not null then 'confirmed'
      when p_payment.status in ('succeeded', 'partially_refunded', 'refunded') then 'refund_required'
      when p_payment.status in ('failed', 'abandoned') then 'failed'
      else 'pending'
    end,
    'payment_status', p_payment.status,
    'reason', p_payment.needs_refund_reason,
    'appointment', (
      select jsonb_build_object('reference', a.reference, 'starts_at', a.starts_at, 'ends_at', a.ends_at)
      from public.appointments a where a.id = p_payment.appointment_id
    )
  );
$$;

revoke execute on function private.payment_outcome(public.payments) from public;
