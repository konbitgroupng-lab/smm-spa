import { requireSupabase } from '../lib/supabase';

// Staff-side reads and admin writes for customers and appointments.
// RLS scopes every query: owners/admins see everything, a therapist sees only
// their own appointments and the customers attached to them.
// Guest bookings are not created here: they go through server-side holds and
// verified payment (Phases 2-3).

export type AppointmentStatus = 'pending_payment' | 'confirmed' | 'completed' | 'cancelled' | 'no_show';

export interface Customer {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
}

export interface Appointment {
  id: string;
  reference: string;
  status: AppointmentStatus;
  startsAt: string;
  endsAt: string;
  locationType: 'sanctuary' | 'mobile';
  serviceAddress: string | null;
  totalMinor: number;
  currency: string;
  customer: Customer | null;
  serviceName: string;
  therapistName: string;
}

const mapCustomer = (row: any): Customer => ({
  id: row.id,
  fullName: row.full_name,
  email: row.email,
  phone: row.phone,
});

export async function listAppointments(range: { from: Date; to: Date }): Promise<Appointment[]> {
  const { data, error } = await requireSupabase()
    .from('appointments')
    .select(
      'id, reference, status, starts_at, ends_at, location_type, service_address, total_minor, currency, ' +
        'customer:customers(id, full_name, email, phone), service:services(name), therapist:therapists(display_name)',
    )
    .gte('starts_at', range.from.toISOString())
    .lt('starts_at', range.to.toISOString())
    .order('starts_at');
  if (error) throw error;
  return (data as any[]).map((row) => ({
    id: row.id,
    reference: row.reference,
    status: row.status,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    locationType: row.location_type,
    serviceAddress: row.service_address,
    totalMinor: row.total_minor,
    currency: row.currency,
    customer: row.customer ? mapCustomer(row.customer) : null,
    serviceName: row.service?.name ?? '',
    therapistName: row.therapist?.display_name ?? '',
  }));
}

export async function listCustomers(): Promise<Customer[]> {
  const { data, error } = await requireSupabase()
    .from('customers')
    .select('id, full_name, email, phone')
    .order('full_name');
  if (error) throw error;
  return (data as any[]).map(mapCustomer);
}

/** Owner/admin only (enforced by RLS). */
export async function createCustomer(input: { fullName: string; email: string; phone?: string }): Promise<Customer> {
  const { data, error } = await requireSupabase()
    .from('customers')
    .insert({ full_name: input.fullName.trim(), email: input.email.trim().toLowerCase(), phone: input.phone?.trim() || null })
    .select('id, full_name, email, phone')
    .single();
  if (error) throw error;
  return mapCustomer(data);
}
