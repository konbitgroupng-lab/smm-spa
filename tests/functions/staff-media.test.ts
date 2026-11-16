import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { handleMediaRequest, MAX_FILE_BYTES, sniffImage, type MediaDeps } from '../../supabase/functions/staff-media/handler';
import { asRole, createStaff, createTestDb, one, rows } from '../db/harness';
import { pgliteRpc } from '../support/rpc';

// The website image upload function against the real database. The caller's
// "token" here is their user id: the test runs the database calls as that
// user, exactly as the Edge Function does with the caller's real token.
// Storage is the test database's storage.objects table, written the way the
// function's server key would write it.

const SITE = 'https://staff.example.test';
const PATH = /^(gallery|services|therapists|site)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp|avif)$/;
let db: PGlite;
const id: Record<string, string> = {};
let files: Map<string, { bytes: Uint8Array; contentType: string }>;

function deps(overrides: Partial<MediaDeps> = {}): MediaDeps {
  return {
    allowedOrigins: [SITE],
    rpc: pgliteRpc(db),
    rpcAsCaller: async (token, fn, args) => {
      const names = Object.keys(args);
      try {
        const r = await asRole(db, 'authenticated', token, () =>
          db.query<any>(`select public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')}) as v`, names.map((n) => args[n])));
        return { data: r.rows[0].v, error: null };
      } catch (err: any) {
        return { data: null, error: { code: err.code, message: err.message } };
      }
    },
    store: async (path, bytes, contentType) => {
      if (files.has(path)) return { ok: false };
      files.set(path, { bytes, contentType });
      await db.query(`insert into storage.objects (bucket_id, name) values ('site-media', $1)`, [path]);
      return { ok: true };
    },
    discard: async (path) => {
      files.delete(path);
      await db.query(`delete from storage.objects where bucket_id = 'site-media' and name = $1`, [path]);
      return { ok: true };
    },
    ...overrides,
  };
}

// Smallest believable files of each kind: the right first bytes and a size header.
const bytes = (...parts: (number[] | string)[]) =>
  new Uint8Array(parts.flatMap((p) => (typeof p === 'string' ? [...p].map((c) => c.charCodeAt(0)) : p)));
const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const PNG = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], be32(13), 'IHDR', be32(640), be32(480), [8, 6, 0, 0, 0], be32(0));
const JPEG = bytes([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10], 'JFIF\0', [1, 1, 0, 0, 1, 0, 1, 0, 0], [0xff, 0xc0, 0x00, 0x11, 8, 0x01, 0xe0, 0x02, 0x80, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
const WEBP = bytes('RIFF', [30, 0, 0, 0], 'WEBP', 'VP8X', [10, 0, 0, 0], [0, 0, 0, 0], [0x1f, 0x03, 0x00], [0x57, 0x02, 0x00]); // 800 x 600
const AVIF = bytes(be32(28), 'ftyp', 'avif', be32(0), 'avif', 'mif1', 'miaf', be32(20), 'ispe', be32(0), be32(1024), be32(768));
const HTML = bytes('<!doctype html><html><script>alert(1)</script></html>');
const SVG = bytes('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>');
const EXE = bytes('MZ', Array(64).fill(0));

function upload(token: string | null, file: Uint8Array | null, fields: Record<string, string> = {}, name = 'photo.png', type = 'image/png', headers: Record<string, string> = {}) {
  const form = new FormData();
  if (file) form.set('file', new File([file], name, { type }));
  for (const [k, v] of Object.entries({ folder: 'gallery', alt_text: 'A quiet room', ...fields })) form.set(k, v);
  return new Request('http://local/functions/v1/staff-media', {
    method: 'POST',
    headers: { origin: SITE, ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: form,
  });
}
const remove = (token: string | null, body: unknown) =>
  new Request('http://local/functions/v1/staff-media', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: SITE, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
const send = async (req: Request, d = deps()) => {
  const res = await handleMediaRequest(req, d);
  return { status: res.status, body: res.status === 204 ? null : await res.json(), res };
};
const stored = async () => Number((await one(db, `select count(*) from storage.objects`)).count);
const version = async (mediaId: string) => (await one(db, `select updated_at::text as v from media_assets where id = $1`, [mediaId])).v;

beforeAll(async () => {
  db = await createTestDb();
  id.owner = await createStaff(db, 'owner@example.com', 'owner');
  id.admin = await createStaff(db, 'admin@example.com', 'admin');
  id.therapist = await createStaff(db, 'therapist@example.com', 'therapist');
  id.inactiveAdmin = await createStaff(db, 'gone@example.com', 'admin', { active: false });
  id.newAccount = (await one(db, `insert into auth.users (email) values ('new@example.com') returning id`)).id;
});

beforeEach(async () => {
  files = new Map();
  await db.query(`delete from private.rate_limit_hits`);
});

describe('reading a file\'s real type', () => {
  it('recognises the four accepted image types and their size, and nothing else', () => {
    expect(sniffImage(PNG)).toEqual({ mime: 'image/png', extension: 'png', width: 640, height: 480 });
    expect(sniffImage(JPEG)).toEqual({ mime: 'image/jpeg', extension: 'jpg', width: 640, height: 480 });
    expect(sniffImage(WEBP)).toEqual({ mime: 'image/webp', extension: 'webp', width: 800, height: 600 });
    expect(sniffImage(AVIF)).toEqual({ mime: 'image/avif', extension: 'avif', width: 1024, height: 768 });
    for (const other of [HTML, SVG, EXE, bytes('GIF89a', Array(20).fill(0)), bytes('%PDF-1.7'), bytes(be32(24), 'ftyp', 'isom', be32(0), 'isom', 'mp42'), new Uint8Array(0), bytes([0xff, 0xd8])]) {
      expect(sniffImage(other)).toBeNull();
    }
  });
});

describe('uploading', () => {
  it('an owner or admin uploads: the file is stored under a generated name and added to the library as them', async () => {
    for (const [actor, file, ext, mime] of [['owner', PNG, 'png', 'image/png'], ['admin', WEBP, 'webp', 'image/webp'], ['admin', JPEG, 'jpg', 'image/jpeg'], ['admin', AVIF, 'avif', 'image/avif']] as const) {
      const { status, body, res } = await send(upload(id[actor], file, { folder: 'gallery' }, '../../evil name.php', 'text/html'));
      expect(status, JSON.stringify(body)).toBe(200);
      expect(body.path).toMatch(PATH);
      expect(body.path.endsWith(`.${ext}`)).toBe(true); // from the content, not the name or declared type
      expect(body.mime_type).toBe(mime);
      expect(files.get(body.path)?.contentType).toBe(mime);
      expect(await one(db, `select created_by, alt_text, size_bytes::int as size_bytes from media_assets where id = $1`, [body.id]))
        .toEqual({ created_by: id[actor], alt_text: 'A quiet room', size_bytes: file.length });
      expect(await one(db, `select actor_id, action from audit_log where entity_type = 'media_assets' and entity_id = $1`, [body.id]))
        .toEqual({ actor_id: id[actor], action: 'content.media_added' });
      expect(res.headers.get('access-control-allow-origin')).toBe(SITE);
    }
    expect((await one(db, `select width, height from media_assets where mime_type = 'image/png' order by created_at desc limit 1`))).toEqual({ width: 640, height: 480 });
  });

  it('only an active owner or admin may upload; nothing is stored for anyone else', async () => {
    const before = await stored();
    expect((await send(upload(null, PNG))).status).toBe(401);
    for (const actor of ['therapist', 'inactiveAdmin', 'newAccount']) {
      expect((await send(upload(id[actor], PNG))).status, actor).toBe(403);
    }
    expect((await send(upload('not-a-user', PNG))).status).toBe(403);
    expect(files.size).toBe(0);
    expect(await stored()).toBe(before);
  });

  it('refuses anything that is not really an image, whatever it is called', async () => {
    const before = Number((await one(db, `select count(*) from media_assets`)).count);
    for (const [file, name, type] of [[HTML, 'photo.png', 'image/png'], [SVG, 'logo.svg', 'image/svg+xml'], [SVG, 'logo.png', 'image/png'], [EXE, 'photo.jpg', 'image/jpeg'], [bytes('GIF89a', Array(20).fill(0)), 'a.gif', 'image/gif']] as const) {
      const { status, body } = await send(upload(id.admin, file, {}, name, type));
      expect([status, body.error], name).toEqual([415, 'unsupported_type']);
    }
    expect(files.size).toBe(0);
    expect(Number((await one(db, `select count(*) from media_assets`)).count)).toBe(before);
  });

  it('refuses files that are too large, empty, or sent to an unknown folder', async () => {
    const big = new Uint8Array(MAX_FILE_BYTES + 1);
    big.set(PNG);
    expect((await send(upload(id.admin, big))).status).toBe(413);
    expect((await send(upload(id.admin, PNG, {}, 'photo.png', 'image/png', { 'content-length': String(50 * 1024 * 1024) }))).status).toBe(413);
    expect((await send(upload(id.admin, new Uint8Array(0)))).body).toEqual({ error: 'invalid_media' });
    expect((await send(upload(id.admin, null))).body).toEqual({ error: 'invalid_media' });
    for (const folder of ['private', '../gallery', 'gallery/../..', '', 'GALLERY']) {
      expect((await send(upload(id.admin, PNG, { folder }))).body, folder).toEqual({ error: 'invalid_media' });
    }
    expect((await send(upload(id.admin, PNG, { alt_text: 'a'.repeat(301) }))).body).toEqual({ error: 'invalid_media' });
    expect(files.size).toBe(0);
    const exact = new Uint8Array(MAX_FILE_BYTES);
    exact.set(PNG);
    expect((await send(upload(id.admin, exact))).status).toBe(200);
  });

  it('if the library refuses the file, it is deleted again', async () => {
    const failing = deps({
      rpcAsCaller: async (token, fn, args) =>
        fn === 'staff_register_media' ? { data: null, error: { message: 'invalid_media' } } : deps().rpcAsCaller(token, fn, args),
    });
    const before = await stored();
    const { status, body } = await send(upload(id.admin, PNG), failing);
    expect([status, body.error]).toEqual([422, 'invalid_media']);
    expect(files.size).toBe(0);
    expect(await stored()).toBe(before);

    const unexpected = deps({
      rpcAsCaller: async (token, fn, args) =>
        fn === 'staff_register_media' ? { data: null, error: { message: 'relation "x" does not exist' } } : deps().rpcAsCaller(token, fn, args),
    });
    expect((await send(upload(id.admin, PNG), unexpected)).body).toEqual({ error: 'server_error' }); // no internals leaked
    expect((await send(upload(id.admin, PNG), deps({ store: async () => ({ ok: false }) }))).body).toEqual({ error: 'upload_failed' });
    expect(files.size).toBe(0);
  });

  it('limits how many files one person uploads per hour', async () => {
    let last = 0;
    for (let i = 0; i < 61; i++) last = (await send(upload(id.admin, PNG))).status;
    expect(last).toBe(429);
    expect((await send(upload(id.owner, PNG))).status).toBe(200); // counted per person
  });

  it('answers other requests safely', async () => {
    expect((await send(new Request('http://local', { method: 'GET', headers: { origin: SITE } }))).status).toBe(405);
    const preflight = await handleMediaRequest(new Request('http://local', { method: 'OPTIONS', headers: { origin: 'https://evil.example' } }), deps());
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBeNull();
    const plain = new Request('http://local', { method: 'POST', headers: { origin: SITE, authorization: `Bearer ${id.admin}`, 'content-type': 'text/plain' }, body: 'hello' });
    expect((await send(plain)).body).toEqual({ error: 'invalid_request' });
  });
});

describe('removing', () => {
  const uploaded = async () => (await send(upload(id.admin, PNG))).body as { id: string; path: string };

  it('an unused file is removed from the library and from storage, with the reason recorded', async () => {
    const m = await uploaded();
    const { status, body } = await send(remove(id.owner, { action: 'remove', mediaId: m.id, reason: 'Uploaded by mistake', expectedUpdatedAt: await version(m.id) }));
    expect([status, body]).toEqual([200, { id: m.id, fileRemoved: true }]);
    expect(files.has(m.path)).toBe(false);
    expect(await rows(db, `select 1 from media_assets where id = $1`, [m.id])).toEqual([]);
    expect(await one(db, `select actor_id, action, reason from audit_log where entity_type = 'media_assets' and entity_id = $1 order by id desc limit 1`, [m.id]))
      .toEqual({ actor_id: id.owner, action: 'content.media_removed', reason: 'Uploaded by mistake' });
  });

  it('a file in use, a missing reason, an old version or an unauthorised caller leaves the file where it is', async () => {
    const m = await uploaded();
    const v = await version(m.id);
    const item = await asRole(db, 'authenticated', id.admin, () =>
      one(db, `select staff_save_gallery_item(null, null, $1) as r`, [JSON.stringify({ title: 'In use', image_media_id: m.id })]));
    const attempt = async (token: string | null, body: Record<string, unknown>) => {
      const r = await send(remove(token, { action: 'remove', mediaId: m.id, reason: 'Tidying up', expectedUpdatedAt: v, ...body }));
      return [r.status, r.body.error];
    };
    expect(await attempt(id.admin, {})).toEqual([409, 'media_in_use']);
    expect(await attempt(id.therapist, {})).toEqual([403, 'not_authorized']);
    expect(await attempt(null, {})).toEqual([401, 'not_authorized']);
    await db.query(`delete from gallery_items where id = $1`, [item.r.id]);
    expect(await attempt(id.admin, { reason: '' })).toEqual([422, 'reason_required']);
    expect(await attempt(id.admin, { expectedUpdatedAt: '2020-01-01T00:00:00Z' })).toEqual([409, 'stale_record']);
    expect(await attempt(id.admin, { mediaId: 'not-an-id' })).toEqual([422, 'invalid_media']);
    expect(await attempt(id.admin, { mediaId: crypto.randomUUID() })).toEqual([404, 'not_found']);
    expect(await attempt(id.admin, { action: 'purge' })).toEqual([400, 'invalid_request']);
    expect((await send(remove(id.admin, '{not json'))).status).toBe(400);
    expect(files.has(m.path)).toBe(true);
    expect(await rows(db, `select 1 from media_assets where id = $1`, [m.id])).toHaveLength(1);
  });

  it('reports when the library entry is gone but the file could not be deleted', async () => {
    const m = await uploaded();
    const { body } = await send(remove(id.admin, { action: 'remove', mediaId: m.id, reason: 'Tidying up', expectedUpdatedAt: await version(m.id) }),
      deps({ discard: async () => { throw new Error('storage down'); } }));
    expect(body).toEqual({ id: m.id, fileRemoved: false });
    expect(await rows(db, `select 1 from media_assets where id = $1`, [m.id])).toEqual([]);
  });
});
