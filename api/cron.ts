// Vercel Cron: manutenção + entrega de webhooks. Protegido por CRON_SECRET (a Vercel envia Authorization: Bearer <CRON_SECRET>).
import { Db, createSql } from '../src/adapters/persistence/db';
import { deliverOutbox } from '../src/modules/integrations/webhooks';

export const config = { maxDuration: 60 };

export default {
  async fetch(req: Request): Promise<Response> {
    const secret = process.env.CRON_SECRET;
    if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) return new Response('Unauthorized', { status: 401 });
    if (!process.env.DATABASE_URL) return new Response('DB not configured', { status: 503 });
    const sql = createSql(process.env.DATABASE_URL);
    try {
      const db = new Db(sql);
      const maintenance = await db.query('job_maintenance', []);
      const webhooks = await deliverOutbox(db);
      return Response.json({ maintenance, webhooks });
    } finally {
      await sql.end({ timeout: 5 });
    }
  },
};
