import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startRealPostgres, type RealPostgres } from '../support/real-postgres';

// Phase 6a on a real PostgreSQL server: content changes arriving at the same
// moment on separate connections.

let database: RealPostgres;
let pool: pg.Pool;
let owner: string;
let admin: string;

async function createStaff(email: string, role: 'owner' | 'admin'): Promise<string> {
  const { rows } = await pool.query(`insert into auth.users (email) values ($1) returning id`, [email]);
  await pool.query(`update profiles set role = $2, is_active = true where id = $1`, [rows[0].id, role]);
  return rows[0].id;
}

/** Runs each statement as a signed-in user, all at the same moment, each on its own connection. */
async function raceAs(calls: { user: string; sql: string; params: unknown[] }[]) {
  const clients = await Promise.all(calls.map(() => pool.connect()));
  try {
    await Promise.all(clients.map(async (c, i) => {
      await c.query('begin');
      await c.query(`select set_config('request.jwt.claim.sub', $1, true)`, [calls[i].user]);
      await c.query('set local role authenticated');
    }));
    const results = await Promise.allSettled(clients.map(async (c, i) => {
      try {
        await c.query(calls[i].sql, calls[i].params);
        await c.query('commit');
      } catch (err) {
        await c.query('rollback');
        throw err;
      }
    }));
    return {
      results: results.map((r) => (r.status === 'fulfilled' ? 'ok' : ((r as PromiseRejectedResult).reason.message as string))),
      won: results.filter((r) => r.status === 'fulfilled').length,
    };
  } finally {
    clients.forEach((c) => c.release());
  }
}

const asStaff = async (user: string, sql: string, params: unknown[] = []) => {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query(`select set_config('request.jwt.claim.sub', $1, true)`, [user]);
    await c.query('set local role authenticated');
    const { rows } = await c.query(`select ${sql} as r`, params);
    await c.query('commit');
    return rows[0].r;
  } catch (err) {
    await c.query('rollback');
    throw err;
  } finally {
    c.release();
  }
};
const version = async (table: string, rowId: string) =>
  (await pool.query(`select updated_at::text as v from ${table} where id = $1`, [rowId])).rows[0].v as string;
const j = (value: unknown) => JSON.stringify(value);
const newFaq = (question: string) => asStaff(admin, `staff_save_faq(null, null, $1)`, [j({ question, answer: ['An answer.'] })]);
async function newMedia() {
  const path = `gallery/${crypto.randomUUID()}.webp`;
  await pool.query(`insert into storage.objects (bucket_id, name) values ('site-media', $1)`, [path]);
  return asStaff(admin, `staff_register_media($1, 1024, 10, 10, '')`, [path]);
}

beforeAll(async () => {
  database = await startRealPostgres(8);
  pool = database.pool;
  owner = await createStaff('owner@example.com', 'owner');
  admin = await createStaff('admin@example.com', 'admin');
}, 180_000);

afterAll(async () => {
  await database?.stop();
});

describe('content edits at the same moment (real PostgreSQL, separate connections)', () => {
  it('two people editing one item from the same version: one wins, the other is told it is stale', async () => {
    const faq = await newFaq('Edited by two people?');
    const v = await version('faqs', faq.id);
    for (let round = 0; round < 3; round++) {
      const seen = round === 0 ? v : await version('faqs', faq.id);
      const { results, won } = await raceAs([
        { user: owner, sql: `select staff_save_faq($1, $2, $3)`, params: [faq.id, seen, j({ question: `Owner wording ${round}?`, answer: ['One.'] })] },
        { user: admin, sql: `select staff_save_faq($1, $2, $3)`, params: [faq.id, seen, j({ question: `Admin wording ${round}?`, answer: ['Two.'] })] },
      ]);
      expect(won, JSON.stringify(results)).toBe(1);
      expect(results.filter((r) => r !== 'ok')).toEqual(['stale_record']);
    }
    const audit = await pool.query(`select count(*)::int as n from audit_log where entity_type = 'faqs' and entity_id = $1 and action = 'content.faq_updated'`, [faq.id]);
    expect(audit.rows[0].n).toBe(3);
  });

  it('publishing against deleting the same item: never both, and nothing published is deleted', async () => {
    for (let round = 0; round < 4; round++) {
      const faq = await newFaq(`Publish or delete ${round}?`);
      const v = await version('faqs', faq.id);
      const { results, won } = await raceAs([
        { user: owner, sql: `select staff_set_content_published('faq', $1, true, $2)`, params: [faq.id, v] },
        { user: admin, sql: `select staff_delete_content('faq', $1, 'Not needed after all', $2)`, params: [faq.id, v] },
      ]);
      expect(won, JSON.stringify(results)).toBe(1);
      expect(results.find((r) => r !== 'ok')).toMatch(/^(stale_record|not_found|still_published)$/);
      const left = await pool.query(`select is_published from faqs where id = $1`, [faq.id]);
      // Either it was published and kept, or deleted while still a draft.
      expect(left.rows.length === 0 || left.rows[0].is_published === true).toBe(true);
    }
  });

  it('reordering against a deletion or an addition: the order is never applied to a list that changed', async () => {
    await pool.query(`update faqs set is_published = false`);
    for (let round = 0; round < 4; round++) {
      const extra = await newFaq(`Reorder against delete ${round}?`);
      const ids = (await pool.query(`select id from faqs order by sort_order, created_at`)).rows.map((r) => r.id);
      const { results } = await raceAs([
        { user: owner, sql: `select staff_reorder_content('faq', $1)`, params: [[...ids].reverse()] },
        { user: admin, sql: `select staff_delete_content('faq', $1, 'Duplicate question', $2)`, params: [extra.id, await version('faqs', extra.id)] },
        { user: admin, sql: `select staff_save_faq(null, null, $1)`, params: [j({ question: `Added during reorder ${round}?`, answer: ['Yes.'] })] },
      ]);
      // No deadlocks or unexpected errors; a refused call is refused as out of date.
      for (const r of results) expect(r).toMatch(/^(ok|stale_record)$/);
      const orders = (await pool.query(`select sort_order from faqs`)).rows.map((r) => r.sort_order);
      expect(orders.every((n) => Number.isInteger(n))).toBe(true);
    }
  });

  it('removing a file against attaching it to a gallery item: the file is never removed while in use', async () => {
    for (let round = 0; round < 6; round++) {
      const m = await newMedia();
      const v = await version('media_assets', m.id);
      const { results, won } = await raceAs([
        { user: owner, sql: `select staff_remove_media($1, 'Tidying the library', $2)`, params: [m.id, v] },
        { user: admin, sql: `select staff_save_gallery_item(null, null, $1)`, params: [j({ title: `Attached ${round}`, image_media_id: m.id })] },
      ]);
      expect(won, JSON.stringify(results)).toBe(1);
      expect(results.find((r) => r !== 'ok')).toMatch(/^(media_in_use|media_not_found)$/);
      const state = await pool.query(
        `select (select count(*)::int from media_assets where id = $1) as media, (select count(*)::int from gallery_items where image_media_id = $1) as items`, [m.id]);
      // Either the file is gone and nothing refers to it, or it is kept and in use.
      expect([j({ media: 0, items: 0 }), j({ media: 1, items: 1 })]).toContain(j(state.rows[0]));
    }
    // No gallery item was left without an image.
    const broken = await pool.query(`select count(*)::int as n from gallery_items where image_url is null and image_media_id is null`);
    expect(broken.rows[0].n).toBe(0);
  });

  it('two people saving a new site content block at once: one creates it, the other is told it is stale', async () => {
    await pool.query(`delete from site_content where key = 'homepage.hero'`);
    const { results, won } = await raceAs([
      { user: owner, sql: `select staff_save_site_content('homepage.hero', null, $1)`, params: [j({ heading: 'Owner heading' })] },
      { user: admin, sql: `select staff_save_site_content('homepage.hero', null, $1)`, params: [j({ heading: 'Admin heading' })] },
    ]);
    expect(won, JSON.stringify(results)).toBe(1);
    expect(results.filter((r) => r !== 'ok')).toEqual(['stale_record']);
    expect((await pool.query(`select count(*)::int as n from site_content where key = 'homepage.hero'`)).rows[0].n).toBe(1);
  });
});
