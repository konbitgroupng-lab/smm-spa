// Applies the repository's pending database migrations to a hosted Supabase
// project through the Management API. For computers where `supabase db push`
// cannot reach the database directly (as on the development PC).
//
//   node --env-file=.env.local scripts/apply-migrations.mjs            lists what is pending (changes nothing)
//   node --env-file=.env.local scripts/apply-migrations.mjs --apply    applies them
//
// Needs SUPABASE_ACCESS_TOKEN (a token with write access) and
// SUPABASE_PROJECT_REF (the project to change: check it twice). Each
// migration runs in one transaction together with its entry in
// supabase_migrations.schema_migrations, so a failure changes nothing and the
// Supabase CLI agrees afterwards about what has been applied. Stops at the
// first failure. Never runs supabase/seed.sql (demo data).

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const apply = process.argv.includes('--apply');
const { SUPABASE_ACCESS_TOKEN: token, SUPABASE_PROJECT_REF: ref } = process.env;
if (!token || !ref) {
  console.error('Set SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF (for example with --env-file=.env.local).');
  process.exit(2);
}
const dir = path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), 'supabase', 'migrations');

async function query(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${text}`);
  return JSON.parse(text);
}
const literal = (s) => `'${s.replace(/'/g, "''")}'`;

console.log(`Project ${ref}: ${apply ? 'APPLYING' : 'listing (nothing is changed; add --apply to apply)'}\n`);
const [{ exists }] = await query(`select to_regclass('supabase_migrations.schema_migrations') is not null as exists`);
if (!exists && apply) {
  // A brand-new project: the history table the Supabase CLI keeps.
  await query(`create schema if not exists supabase_migrations;
    create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text)`);
}
const applied = new Set(exists ? (await query('select version from supabase_migrations.schema_migrations')).map((r) => r.version) : []);

let pending = 0;
for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
  const [version, ...rest] = file.replace(/\.sql$/, '').split('_');
  if (applied.has(version)) {
    console.log(`applied   ${file}`);
    continue;
  }
  pending++;
  if (!apply) {
    console.log(`PENDING   ${file}`);
    continue;
  }
  const sql = readFileSync(path.join(dir, file), 'utf8');
  try {
    await query(`begin;\n${sql}\n;\ninsert into supabase_migrations.schema_migrations (version, name, statements) values (${literal(version)}, ${literal(rest.join('_'))}, array[${literal(sql)}]);\ncommit;`);
    console.log(`APPLIED   ${file}`);
  } catch (err) {
    console.error(`FAILED    ${file}\n${String(err.message).slice(0, 2000)}\nNothing from this migration was applied. Stopping.`);
    process.exit(1);
  }
}
console.log(`\n${pending ? `${pending} ${apply ? 'applied' : 'pending'}` : 'Nothing pending.'}`);
