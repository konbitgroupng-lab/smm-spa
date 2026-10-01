// Public booking endpoint logic: input validation, rate limiting and error
// mapping around the database booking functions.
//
// This file uses only Web-standard APIs, so the same code runs in the Supabase
// Edge runtime (see index.ts) and in the Node test suite. All booking rules
// live in the database; nothing here decides whether a slot is free.

export interface RpcError {
  code?: string;
  message: string;
  details?: string | null;
}

export interface BookingDeps {
  /** Calls a database function with service-role privileges. */
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: any; error: RpcError | null }>;
  /** Opaque per-visitor key for rate limiting (a hash, never a raw IP). */
  clientKey: (req: Request) => Promise<string>;
  /** Origins allowed to call the endpoint from a browser. */
  allowedOrigins: string[];
}

const WINDOW_SECONDS = 600;
const LIMITS: Record<string, number> = {
  create_hold: 10,
  attach_customer: 30,
  release_hold: 30,
};

const MAX_BODY_BYTES = 4096;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Database error -> HTTP status. Anything not listed is reported as a generic
// server error so internal details never reach the browser.
const ERROR_STATUS: Record<string, number> = {
  slot_unavailable: 409,
  hold_expired: 410,
  service_unavailable: 422,
  therapist_unavailable: 422,
  dispatch_zone_required: 422,
  invalid_customer: 422,
};

class InvalidRequest extends Error {}

function uuid(value: unknown, field: string, required: true): string;
function uuid(value: unknown, field: string, required?: false): string | null;
function uuid(value: unknown, field: string, required = false): string | null {
  if (value === undefined || value === null) {
    if (required) throw new InvalidRequest(field);
    return null;
  }
  if (typeof value !== 'string' || !UUID.test(value)) throw new InvalidRequest(field);
  return value;
}

function text(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maxLength) {
    throw new InvalidRequest(field);
  }
  return value;
}

function timestamp(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length > 40 || Number.isNaN(Date.parse(value))) {
    throw new InvalidRequest(field);
  }
  return new Date(value).toISOString();
}

/** The only hold fields a guest ever receives. */
function publicHold(hold: any) {
  return {
    token: hold.hold_token,
    therapistId: hold.therapist_id,
    startsAt: hold.starts_at,
    endsAt: hold.ends_at,
    expiresAt: hold.expires_at,
    hasCustomer: hold.customer_id !== null,
  };
}

async function run(action: string, body: Record<string, unknown>, deps: BookingDeps) {
  switch (action) {
    case 'create_hold': {
      const locationType = body.locationType ?? 'sanctuary';
      if (locationType !== 'sanctuary' && locationType !== 'mobile') throw new InvalidRequest('locationType');
      const result = await deps.rpc('request_booking_hold', {
        p_service_id: uuid(body.serviceId, 'serviceId', true),
        p_starts_at: timestamp(body.startsAt, 'startsAt'),
        p_therapist_id: uuid(body.therapistId, 'therapistId'),
        p_location_type: locationType,
        p_dispatch_zone_id: uuid(body.dispatchZoneId, 'dispatchZoneId'),
        p_replace_hold_token: uuid(body.replaceHoldToken, 'replaceHoldToken'),
      });
      return { ...result, data: result.error ? null : { hold: publicHold(result.data) } };
    }
    case 'attach_customer': {
      const result = await deps.rpc('attach_customer_to_hold', {
        p_hold_token: uuid(body.holdToken, 'holdToken', true),
        p_full_name: text(body.fullName, 'fullName', 120),
        p_email: text(body.email, 'email', 254),
        p_phone: text(body.phone, 'phone', 20),
      });
      return { ...result, data: result.error ? null : { hold: publicHold(result.data) } };
    }
    case 'release_hold': {
      const result = await deps.rpc('release_booking_hold', {
        p_hold_token: uuid(body.holdToken, 'holdToken', true),
      });
      return { ...result, data: result.error ? null : { released: result.data === true } };
    }
    default:
      throw new InvalidRequest('action');
  }
}

export async function handleBookingRequest(req: Request, deps: BookingDeps): Promise<Response> {
  const origin = req.headers.get('origin');
  const headers: Record<string, string> = { 'content-type': 'application/json', vary: 'Origin' };
  if (origin && deps.allowedOrigins.includes(origin)) {
    headers['access-control-allow-origin'] = origin;
    headers['access-control-allow-headers'] = 'authorization, apikey, content-type, x-client-info';
    headers['access-control-allow-methods'] = 'POST, OPTIONS';
  }
  const reply = (status: number, payload: unknown) => new Response(JSON.stringify(payload), { status, headers });

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (req.method !== 'POST') return reply(405, { error: 'method_not_allowed' });

  let body: Record<string, unknown>;
  try {
    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) return reply(413, { error: 'payload_too_large' });
    body = JSON.parse(raw);
    if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new Error();
  } catch {
    return reply(400, { error: 'invalid_request', field: 'body' });
  }

  const action = typeof body.action === 'string' ? body.action : '';
  const limit = LIMITS[action];
  if (limit === undefined) return reply(400, { error: 'invalid_request', field: 'action' });

  try {
    const allowed = await deps.rpc('consume_rate_limit', {
      p_key: `${action}:${await deps.clientKey(req)}`,
      p_limit: limit,
      p_window_seconds: WINDOW_SECONDS,
    });
    if (allowed.error) throw new Error(allowed.error.message);
    if (allowed.data !== true) return reply(429, { error: 'rate_limited' });

    const { data, error } = await run(action, body, deps);
    if (error) {
      const status = ERROR_STATUS[error.message];
      if (!status) {
        console.error('booking:', action, error.code, error.message);
        return reply(500, { error: 'server_error' });
      }
      const reason = error.message === 'slot_unavailable' ? error.details ?? undefined : undefined;
      return reply(status, { error: error.message, reason });
    }
    return reply(200, data);
  } catch (err) {
    if (err instanceof InvalidRequest) return reply(400, { error: 'invalid_request', field: err.message });
    console.error('booking:', action, err);
    return reply(500, { error: 'server_error' });
  }
}
