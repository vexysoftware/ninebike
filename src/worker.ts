// Entrada do Cloudflare Worker: /api/v1 e /public/v1 vão para a aplicação; o resto é servido pelos assets estáticos (SPA).
import { createApp } from './app';
import { buildDeps } from './runtime';
import { Db, createSql } from './adapters/persistence/db';
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
    const { deps, close } = buildDeps(env, conn);
    try {
      return await createApp(deps)(req);
    } finally {
      ctx.waitUntil(close());
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
