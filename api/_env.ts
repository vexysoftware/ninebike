// Variáveis na Vercel: aceita as da integração Supabase↔Vercel e deriva o que falta.
import type { RuntimeEnv } from '../src/runtime';

/** Conexão do backend com o papel restrito ninebike_api pelo pooler do Supabase (transaction mode). */
export function apiDatabaseUrl(e: NodeJS.ProcessEnv): string | undefined {
  if (e.DATABASE_URL) return e.DATABASE_URL;
  const base = e.POSTGRES_URL; // postgres://postgres.<ref>:<senha>@aws-...pooler.supabase.com:6543/postgres
  const pw = e.NINEBIKE_API_DB_PASSWORD;
  if (!base || !pw) return undefined;
  const u = new URL(base);
  const ref = decodeURIComponent(u.username).split('.')[1];
  u.username = ref ? `ninebike_api.${ref}` : 'ninebike_api';
  u.password = encodeURIComponent(pw);
  u.searchParams.delete('supa');
  u.searchParams.set('sslmode', 'require');
  return u.toString();
}

export function runtimeEnv(e: NodeJS.ProcessEnv): RuntimeEnv {
  const host = e.APP_ORIGIN ?? (e.VERCEL_PROJECT_PRODUCTION_URL ? `https://${e.VERCEL_PROJECT_PRODUCTION_URL}` : e.VERCEL_URL ? `https://${e.VERCEL_URL}` : 'http://localhost');
  return {
    ENVIRONMENT: (e.ENVIRONMENT as RuntimeEnv['ENVIRONMENT']) ?? (e.VERCEL_ENV === 'production' ? 'production' : 'staging'),
    DEPLOY_ID: e.VERCEL_GIT_COMMIT_SHA?.slice(0, 12),
    APP_ORIGIN: host,
    SUPABASE_URL: e.SUPABASE_URL ?? e.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_JWT_SECRET: e.SUPABASE_JWT_SECRET,
    SUPABASE_JWT_ISSUER: e.SUPABASE_JWT_ISSUER,
    SUPABASE_SERVICE_ROLE_KEY: e.SUPABASE_SERVICE_ROLE_KEY,
    STORAGE_BUCKET: e.STORAGE_BUCKET,
    DATABASE_URL: apiDatabaseUrl(e),
  };
}
