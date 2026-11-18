// Aplica supabase/migrations em ordem num PostgreSQL local/teste (com o shim de auth).
// Em Supabase real use `supabase db push`; este script recusa rodar com NINEBIKE_ENV=production.
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export async function migrate({ url, reset = false, log = console.log } = {}) {
  if (process.env.NINEBIKE_ENV === 'production') throw new Error('migrate.mjs é somente local/teste');
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    if (reset) {
      await sql.unsafe(`drop schema if exists api, inventory, crm, integrations, audit, identity, auth cascade;
        drop table if exists public.ninebike_migrations;`);
    }
    await sql.unsafe(readFileSync(join(root, 'scripts/supabase-local-shim.sql'), 'utf8'));
    await sql.unsafe(`create table if not exists public.ninebike_migrations (name text primary key, applied_at timestamptz default now())`);
    const done = new Set((await sql`select name from public.ninebike_migrations`).map((r) => r.name));
    const dir = join(root, 'supabase/migrations');
    for (const f of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
      if (done.has(f)) continue;
      await sql.begin(async (tx) => {
        await tx.unsafe(readFileSync(join(dir, f), 'utf8'));
        await tx`insert into public.ninebike_migrations (name) values (${f})`;
      });
      log(`applied ${f}`);
    }
  } finally {
    await sql.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const url = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:54329/ninebike';
  migrate({ url, reset: process.argv.includes('--reset') }).catch((e) => { console.error(e.message); process.exit(1); });
}
