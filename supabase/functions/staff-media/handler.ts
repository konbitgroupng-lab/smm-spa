// Website image uploads and removals for owner and admin (Phase 6a).
//
// Staff cannot write to Storage themselves. This function does it for them,
// after asking the database, with the caller's own sign-in token, who they
// are (staff_whoami): only an active owner or admin passes.
//
// Upload (multipart form: file, folder, alt_text):
//   1. The file's real type is read from its first bytes. Only JPEG, PNG,
//      WebP and AVIF are accepted, whatever its name or declared type says.
//   2. It is stored under a generated name: <folder>/<random id>.<extension>.
//   3. It is added to the media library as the caller (staff_register_media),
//      which records who added it. If that fails, the file is deleted again.
//
// Removal (JSON: action "remove", mediaId, reason, expectedUpdatedAt):
//   the database refuses while anything uses the file; then the file is deleted.
//
// Web-standard APIs only, so the same code runs in the Edge runtime
// (index.ts) and in the Node tests.

import { corsHeaders, readJsonObject, UUID, withinRateLimit, type Rpc } from '../_shared/http.ts';

export interface MediaDeps {
  allowedOrigins: string[];
  /** Database calls with service-role privileges (rate limiting only). */
  rpc: Rpc;
  /** A database function called as the signed-in caller, with their token. */
  rpcAsCaller: (token: string, fn: string, args: Record<string, unknown>) => ReturnType<Rpc>;
  /** Stores a file in the site-media bucket. Must not overwrite. */
  store: (path: string, bytes: Uint8Array, contentType: string) => Promise<{ ok: true } | { ok: false }>;
  /** Deletes a file from the site-media bucket. */
  discard: (path: string) => Promise<{ ok: boolean }>;
}

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_FORM_BYTES = MAX_FILE_BYTES + 16 * 1024; // the file plus the form's own overhead
const MAX_JSON_BYTES = 2048;
const UPLOADS_PER_HOUR = 60;
const FOLDERS = ['gallery', 'services', 'therapists', 'site'];
const MAX_DIMENSION = 20000;

export interface ImageInfo {
  mime: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/avif';
  extension: 'jpg' | 'png' | 'webp' | 'avif';
  width: number | null;
  height: number | null;
}

const ascii = (b: Uint8Array, at: number, length: number) => String.fromCharCode(...b.subarray(at, at + length));
const u16be = (b: Uint8Array, at: number) => (b[at] << 8) | b[at + 1];
const u32be = (b: Uint8Array, at: number) => ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;
const u24le = (b: Uint8Array, at: number) => b[at] | (b[at + 1] << 8) | (b[at + 2] << 16);

/** What a file really is, from its content. Null unless it is one of the four accepted image types. */
export function sniffImage(b: Uint8Array): ImageInfo | null {
  if (b.length >= 24 && u32be(b, 0) === 0x89504e47 && u32be(b, 4) === 0x0d0a1a0a && ascii(b, 12, 4) === 'IHDR') {
    return { mime: 'image/png', extension: 'png', width: u32be(b, 16), height: u32be(b, 20) };
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    // Walk the segments to the frame header, which holds the size.
    let at = 2;
    while (at + 9 < b.length && b[at] === 0xff) {
      const marker = b[at + 1];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { mime: 'image/jpeg', extension: 'jpg', width: u16be(b, at + 7), height: u16be(b, at + 5) };
      }
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) at += 2;
      else at += 2 + u16be(b, at + 2);
    }
    return { mime: 'image/jpeg', extension: 'jpg', width: null, height: null };
  }
  if (b.length >= 30 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') {
    const chunk = ascii(b, 12, 4);
    let width: number | null = null;
    let height: number | null = null;
    if (chunk === 'VP8X') {
      width = u24le(b, 24) + 1;
      height = u24le(b, 27) + 1;
    } else if (chunk === 'VP8 ' && b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a) {
      width = (b[26] | (b[27] << 8)) & 0x3fff;
      height = (b[28] | (b[29] << 8)) & 0x3fff;
    } else if (chunk === 'VP8L' && b[20] === 0x2f) {
      const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
      width = (bits & 0x3fff) + 1;
      height = ((bits >>> 14) & 0x3fff) + 1;
    } else if (chunk !== 'VP8 ' && chunk !== 'VP8L') {
      return null;
    }
    return { mime: 'image/webp', extension: 'webp', width, height };
  }
  if (b.length >= 16 && ascii(b, 4, 4) === 'ftyp') {
    const size = Math.min(u32be(b, 0), b.length);
    const brands = [ascii(b, 8, 4)];
    for (let at = 16; at + 4 <= size; at += 4) brands.push(ascii(b, at, 4));
    if (!brands.includes('avif') && !brands.includes('avis')) return null;
    // The size sits in an "ispe" box somewhere in the header.
    for (let at = size; at + 16 <= Math.min(b.length, 65536); at++) {
      if (b[at] === 0x69 && ascii(b, at, 4) === 'ispe') {
        return { mime: 'image/avif', extension: 'avif', width: u32be(b, at + 8), height: u32be(b, at + 12) };
      }
    }
    return { mime: 'image/avif', extension: 'avif', width: null, height: null };
  }
  return null;
}

/** Database refusals the caller can act on; anything else is reported as a server error. */
const REFUSALS: Record<string, number> = {
  not_authorized: 403, not_found: 404, stale_record: 409, media_in_use: 409, media_exists: 409,
  reason_required: 422, invalid_media: 422, media_not_uploaded: 422,
};

export async function handleMediaRequest(req: Request, deps: MediaDeps): Promise<Response> {
  const headers = corsHeaders(req.headers.get('origin'), deps.allowedOrigins);
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers });
  const refuse = (message: string | undefined) => {
    const code = message && message in REFUSALS ? message : 'server_error';
    return reply(REFUSALS[code] ?? 500, { error: code });
  };

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (req.method !== 'POST') return reply(405, { error: 'method_not_allowed' });

  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return reply(401, { error: 'not_authorized' });

  // Who is asking, according to the database, as themselves.
  const who = await deps.rpcAsCaller(token, 'staff_whoami', {});
  const role = who.data?.effective_role;
  if (who.error || (role !== 'owner' && role !== 'admin')) return reply(403, { error: 'not_authorized' });
  const callerId = String(who.data.user_id);

  const contentType = (req.headers.get('content-type') ?? '').toLowerCase();

  if (contentType.startsWith('application/json')) {
    const body = await readJsonObject(req, MAX_JSON_BYTES);
    if (body === 'too_large') return reply(413, { error: 'too_large' });
    if (body === 'invalid' || body.action !== 'remove') return reply(400, { error: 'invalid_request' });
    if (typeof body.mediaId !== 'string' || !UUID.test(body.mediaId) || typeof body.expectedUpdatedAt !== 'string') {
      return reply(422, { error: 'invalid_media' });
    }
    const removed = await deps.rpcAsCaller(token, 'staff_remove_media', {
      p_media_id: body.mediaId,
      p_reason: typeof body.reason === 'string' ? body.reason : null,
      p_expected_updated_at: body.expectedUpdatedAt,
    });
    if (removed.error) return refuse(removed.error.message);
    // The library entry is gone; a file that could not be deleted is unreachable from the site.
    const file = await deps.discard(String(removed.data.path)).catch(() => ({ ok: false }));
    return reply(200, { id: removed.data.id, fileRemoved: file.ok });
  }

  if (!contentType.startsWith('multipart/form-data')) return reply(400, { error: 'invalid_request' });
  const declared = Number(req.headers.get('content-length') ?? '0');
  if (declared > MAX_FORM_BYTES) return reply(413, { error: 'too_large' });

  try {
    if (!(await withinRateLimit(deps.rpc, `staff-media:${callerId}`, UPLOADS_PER_HOUR, 3600))) {
      return reply(429, { error: 'rate_limited' });
    }
  } catch {
    return reply(500, { error: 'server_error' });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return reply(400, { error: 'invalid_request' });
  }
  const file = form.get('file');
  const folder = form.get('folder');
  const altText = form.get('alt_text') ?? '';
  if (!(file instanceof Blob) || typeof folder !== 'string' || !FOLDERS.includes(folder) || typeof altText !== 'string' || altText.length > 300) {
    return reply(422, { error: 'invalid_media' });
  }
  if (file.size > MAX_FILE_BYTES) return reply(413, { error: 'too_large' });
  if (file.size === 0) return reply(422, { error: 'invalid_media' });

  const bytes = new Uint8Array(await file.arrayBuffer());
  const image = sniffImage(bytes);
  if (!image) return reply(415, { error: 'unsupported_type' });
  const sized = (n: number | null) => (n !== null && n >= 1 && n <= MAX_DIMENSION ? n : null);

  const path = `${folder}/${crypto.randomUUID()}.${image.extension}`;
  const stored = await deps.store(path, bytes, image.mime).catch(() => ({ ok: false as const }));
  if (!stored.ok) return reply(502, { error: 'upload_failed' });

  const registered = await deps.rpcAsCaller(token, 'staff_register_media', {
    p_path: path,
    p_size_bytes: bytes.length,
    p_width: sized(image.width),
    p_height: sized(image.height),
    p_alt_text: altText,
  });
  if (registered.error) {
    await deps.discard(path).catch(() => undefined); // never leave an unlisted file behind
    return refuse(registered.error.message);
  }
  return reply(200, registered.data);
}
