// Montagem das dependências a partir das variáveis de ambiente — comum ao Cloudflare Worker e à Vercel.
import type { AppDeps } from './app';
import { Db, createSql, type Sql } from './adapters/persistence/db';
import { SupabaseAuthAdmin, SupabaseStorage } from './adapters/providers/supabase';
import { makeDevLogin } from './dev/dev-login';

export type RuntimeEnv = {
  ENVIRONMENT: 'local' | 'test' | 'staging' | 'production';
  DEPLOY_ID?: string;
  APP_ORIGIN: string;
  SUPABASE_URL?: string;
  SUPABASE_JWT_ISSUER?: string;
  SUPABASE_JWT_SECRET?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  STORAGE_BUCKET?: string;
  DATABASE_URL?: string;
  DEV_JWT_SECRET?: string;
  DEV_ADMIN_DATABASE_URL?: string;
};

export function buildDeps(env: RuntimeEnv, conn: string): { deps: AppDeps; close: () => Promise<void> } {
  const sql: Sql = createSql(conn);
  const local = env.ENVIRONMENT === 'local';
  const adminSql = local && env.DEV_ADMIN_DATABASE_URL ? createSql(env.DEV_ADMIN_DATABASE_URL) : null;
  const issuer = env.SUPABASE_JWT_ISSUER ?? (env.SUPABASE_URL ? `${env.SUPABASE_URL}/auth/v1` : 'ninebike-local');
  const deps: AppDeps = {
    db: new Db(sql),
    environment: env.ENVIRONMENT,
    deployId: env.DEPLOY_ID ?? null,
    appOrigin: env.APP_ORIGIN,
    auth: {
      issuer,
      audience: 'authenticated',
      jwksUrl: env.SUPABASE_URL ? `${env.SUPABASE_URL}/auth/v1/.well-known/jwks.json` : undefined,
      hs256Secret: local ? env.DEV_JWT_SECRET : env.SUPABASE_JWT_SECRET,
    },
    storage: env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY ? new SupabaseStorage(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY) : null,
    storageBucket: env.STORAGE_BUCKET ?? 'ninebike-private',
    authAdmin: env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY
      ? new SupabaseAuthAdmin(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
      : local && adminSql
        ? { inviteUser: async (email) => console.log(`[local] convite registrado para ${email}: entre com este e-mail em /app/entrar`) }
        : null,
    devLogin: adminSql && env.DEV_JWT_SECRET ? makeDevLogin(adminSql, env.DEV_JWT_SECRET, issuer) : undefined,
  };
  return { deps, close: async () => { await Promise.all([sql.end({ timeout: 5 }), adminSql?.end({ timeout: 5 })]); } };
}
