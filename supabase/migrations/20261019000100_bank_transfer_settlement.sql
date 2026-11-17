-- Guest bookings paid by direct bank transfer (part 1 of 2).
--
-- A new way an online booking is settled. On its own: PostgreSQL only lets a
-- new enum value be used once the statement adding it has been committed, and
-- each migration runs in its own transaction. 20261019000200 uses it.

alter type public.booking_settlement add value if not exists 'bank_transfer';
