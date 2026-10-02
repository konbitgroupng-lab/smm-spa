// Small request helpers shared by the payment functions. Web-standard APIs only.

export interface RpcError {
  code?: string;
  message: string;
  details?: string | null;
}

/** Calls a database function with service-role privileges. */
export type Rpc = (fn: string, args: Record<string, unknown>) => Promise<{ data: any; error: RpcError | null }>;

export class InvalidRequest extends Error {}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function corsHeaders(origin: string | null, allowedOrigins: string[]): Record<string, string> {
  const headers: Record<string, string> = { 'content-type': 'application/json', vary: 'Origin' };
  if (origin && allowedOrigins.includes(origin)) {
    headers['access-control-allow-origin'] = origin;
    headers['access-control-allow-headers'] = 'authorization, apikey, content-type, x-client-info';
    headers['access-control-allow-methods'] = 'POST, OPTIONS';
  }
  return headers;
}

/** Reads a JSON object body, refusing anything over `maxBytes`. */
export async function readJsonObject(req: Request, maxBytes: number): Promise<Record<string, unknown> | 'too_large' | 'invalid'> {
  try {
    const raw = await req.text();
    if (raw.length > maxBytes) return 'too_large';
    const body = JSON.parse(raw);
    if (typeof body !== 'object' || body === null || Array.isArray(body)) return 'invalid';
    return body;
  } catch {
    return 'invalid';
  }
}

export function optionalText(value: unknown, field: string, maxLength: number): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > maxLength) throw new InvalidRequest(field);
  return value;
}

/** Counts one attempt against a per-visitor fixed window. */
export async function withinRateLimit(rpc: Rpc, key: string, limit: number, windowSeconds: number): Promise<boolean> {
  const { data, error } = await rpc('consume_rate_limit', { p_key: key, p_limit: limit, p_window_seconds: windowSeconds });
  if (error) throw new Error(error.message);
  return data === true;
}

/** The salted hash that identifies a visitor for rate limiting (never a raw IP). */
export async function visitorKey(req: Request, salt: string): Promise<string> {
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}:${ip}`));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}
