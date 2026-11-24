// Entrada do Cloudflare Worker: /api/v1 e /public/v1 vão para a aplicação; o resto é servido pelos assets estáticos (SPA).
import { createApp, type AppDeps } from './app';
import { Db, createSql } from './adapters/persistence/db';
import { SupabaseAuthAdmin, SupabaseStorage } from './adapters/providers/supabase';
import { makeDevLogin } from './dev/dev-login';
import { deliverOutbox } from './modules/integrations/webhooks';

export interface Env {
  ASSETS: Fetcher;
  HYPERDRIVE?: Hyperdrive;
  ENVIRONMENT: 'local' | 'test' | 'staging' | 'production';
  DEPLOY_ID?: string;
  APP_ORIGIN: string;
  SUPABASE_URL?: string;
  SUPABASE_JWT_ISSUER?: string;
  SUPABASE_JWT_SECRET?: string; // segredo do projeto (secret, nunca no Git)
  SUPABASE_SERVICE_ROLE_KEY?: string; // secret; só servidor
  STORAGE_BUCKET?: string;
  DATABASE_URL?: string; // alternativa local ao Hyperdrive (papel ninebike_api)
  DEV_JWT_SECRET?: string; // apenas local
  DEV_ADMIN_DATABASE_URL?: string; // apenas local
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    if (!url.pathname.startsWith('/api/') && !url.pathname.startsWith('/public/v1/') && !url.pathname.startsWith('/agent/v1/')) return env.ASSETS.fetch(req);
    const conn = env.HYPERDRIVE?.connectionString ?? env.DATABASE_URL;
    if (!conn) return new Response(JSON.stringify({ code: 'DEPENDENCY_UNAVAILABLE', message: 'Banco não configurado.' }), { status: 503 });
    const sql = createSql(conn);
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
    try {
      return await createApp(deps)(req);
    } finally {
      ctx.waitUntil(Promise.all([sql.end({ timeout: 5 }), adminSql?.end({ timeout: 5 })]));
    }
  },
  // Rotina a cada 5 min: expira reservas, limpa registros técnicos e entrega webhooks pendentes.
  async scheduled(_ev: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const conn = env.HYPERDRIVE?.connectionString ?? env.DATABASE_URL;
    if (!conn) return;
    const sql = createSql(conn);
    const db = new Db(sql);
    try {
      const m = await db.query('job_maintenance', []);
      const w = await deliverOutbox(db);
      console.log('job', JSON.stringify({ maintenance: m, webhooks: w }));
    } finally {
      ctx.waitUntil(sql.end({ timeout: 5 }));
    }
  },
} satisfies ExportedHandler<Env>;
