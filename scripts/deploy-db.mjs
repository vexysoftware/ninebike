// Executado no build da Vercel: aplica as migrations no Supabase, ativa o papel do backend e prepara o 1º dono.
// Usa as variáveis da integração Supabase↔Vercel (POSTGRES_URL_NON_POOLING) e as do projeto:
//   NINEBIKE_API_DB_PASSWORD  senha do papel ninebike_api (obrigatória em produção)
//   NINEBIKE_OWNER_EMAIL / NINEBIKE_OWNER_NAME  primeiro proprietário (opcional; só enquanto não existir OWNER)
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const url = process.env.POSTGRES_URL_NON_POOLING ?? process.env.SUPABASE_DB_URL;
const vercelEnv = process.env.VERCEL_ENV ?? 'development';
if (!url) {
  if (vercelEnv === 'production') { console.error('[db] POSTGRES_URL_NON_POOLING ausente: conecte o Supabase ao projeto na Vercel.'); process.exit(1); }
  console.log('[db] sem banco configurado; migrations puladas.');
  process.exit(0);
}
const sql = postgres(url.replace(/[?&]sslmode=[^&]*/, ''), { max: 1, ssl: /@(localhost|127\.0\.0\.1)[:\/]/.test(url) ? false : 'require', prepare: false, onnotice: () => {} });
try {
  const [{ ok }] = await sql`select to_regclass('auth.users') is not null as ok`;
  if (!ok) throw new Error('auth.users não existe: este banco não é um projeto Supabase.');
  await sql`create table if not exists public.ninebike_migrations (name text primary key, applied_at timestamptz default now())`;
  await sql`revoke all on public.ninebike_migrations from public`;
  const done = new Set((await sql`select name from public.ninebike_migrations`).map((r) => r.name));
  const dir = join(root, 'supabase/migrations');
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    if (done.has(f)) continue;
    await sql.begin(async (tx) => {
      await tx.unsafe(readFileSync(join(dir, f), 'utf8'));
      await tx`insert into public.ninebike_migrations (name) values (${f})`;
    });
    console.log(`[db] aplicada ${f}`);
  }
  const pw = process.env.NINEBIKE_API_DB_PASSWORD;
  if (pw) {
    if (pw.length < 24) throw new Error('NINEBIKE_API_DB_PASSWORD precisa de 24+ caracteres.');
    await sql.unsafe(`alter role ninebike_api login password '${pw.replace(/'/g, "''")}'`);
    console.log('[db] papel ninebike_api ativo.');
  } else if (vercelEnv === 'production') {
    throw new Error('Defina NINEBIKE_API_DB_PASSWORD nas variáveis do projeto na Vercel.');
  }
  // Bucket privado das fotos.
  const [{ st }] = await sql`select to_regclass('storage.buckets') is not null as st`;
  if (st) await sql`insert into storage.buckets (id, name, public) values ('ninebike-private', 'ninebike-private', false) on conflict (id) do nothing`;
  // Primeiro proprietário: se o usuário já existe no Auth, promove agora; senão, o gatilho promove quando ele for criado.
  const email = process.env.NINEBIKE_OWNER_EMAIL?.trim().toLowerCase();
  if (email) {
    const name = process.env.NINEBIKE_OWNER_NAME?.trim() || email.split('@')[0];
    const r = await sql`select identity.bootstrap_owner(${email}, ${name}) as r`;
    console.log(`[db] proprietário inicial: ${r[0].r}`);
  }
} catch (e) {
  console.error(`[db] falhou: ${e.message}`);
  process.exitCode = 1;
} finally {
  await sql.end();
}
