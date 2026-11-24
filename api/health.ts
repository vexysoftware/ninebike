// Diagnóstico público sem segredos: qual projeto Supabase está configurado e se o banco responde com o papel restrito.
import postgres from 'postgres';
import { apiDatabaseUrl } from './_env';

const refOf = (s?: string) => (s ? (/([a-z0-9]{20})/.exec(s)?.[1] ?? null) : null);

export default {
  async fetch(): Promise<Response> {
    const e = process.env;
    const out: Record<string, unknown> = {
      vercel_env: e.VERCEL_ENV ?? null,
      commit: e.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
      supabase_project_in_SUPABASE_URL: refOf(e.SUPABASE_URL ?? e.NEXT_PUBLIC_SUPABASE_URL),
      supabase_project_in_POSTGRES_URL: refOf(e.POSTGRES_URL),
      has: {
        POSTGRES_URL: !!e.POSTGRES_URL, POSTGRES_URL_NON_POOLING: !!e.POSTGRES_URL_NON_POOLING, SUPABASE_URL: !!(e.SUPABASE_URL ?? e.NEXT_PUBLIC_SUPABASE_URL),
        SUPABASE_JWT_SECRET: !!e.SUPABASE_JWT_SECRET, NINEBIKE_API_DB_PASSWORD: !!e.NINEBIKE_API_DB_PASSWORD, CRON_SECRET: !!e.CRON_SECRET,
        NINEBIKE_OWNER_EMAIL: !!e.NINEBIKE_OWNER_EMAIL,
      },
    };
    out.same_project = out.supabase_project_in_SUPABASE_URL !== null && out.supabase_project_in_SUPABASE_URL === out.supabase_project_in_POSTGRES_URL;
    const conn = apiDatabaseUrl(e);
    if (!conn) {
      out.db = 'sem conexão configurada (falta POSTGRES_URL ou NINEBIKE_API_DB_PASSWORD neste ambiente)';
    } else {
      const sql = postgres(conn, { max: 1, prepare: false, connect_timeout: 8, onnotice: () => {} });
      try {
        const [r] = await sql`select current_user as usr, current_database() as db, api.health() as h`;
        out.db = 'ok';
        out.connected_as = r.usr;
        out.app = r.h;
      } catch (err) {
        out.db = 'erro';
        out.db_error_code = (err as { code?: string }).code ?? null;
        out.db_error = String((err as Error).message ?? '').slice(0, 160);
      } finally {
        await sql.end({ timeout: 3 });
      }
    }
    return new Response(JSON.stringify(out, null, 2), { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
  },
};
