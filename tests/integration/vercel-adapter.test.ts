// Adaptador Vercel: caminho reescrito via __route, IP normalizado e cron protegido.
import { describe, expect, it } from 'vitest';
import server from '../../api/server';
import cron from '../../api/cron';
import { API_URL } from '../support/env';

describe('Vercel', () => {
  it('reescrita leva /api/v1 à app; caminho fora da lista → 404', async () => {
    Object.assign(process.env, { DATABASE_URL: API_URL, ENVIRONMENT: 'test', APP_ORIGIN: 'https://x', SUPABASE_JWT_SECRET: 'x'.repeat(32) });
    const r = await server.fetch(new Request('https://app.vercel.app/api/server?__route=/api/v1/session'));
    expect(r.status).toBe(401);
    expect(((await r.json()) as { code: string }).code).toBe('AUTH_REQUIRED');
    expect((await server.fetch(new Request('https://app.vercel.app/api/server?__route=/etc/passwd'))).status).toBe(404);
    const pub = await server.fetch(new Request('https://app.vercel.app/api/server?__route=/agent/v1/products&q=bike'));
    expect(pub.status).toBe(401);
  });
  it('cron sem segredo → 401; com segredo roda manutenção', async () => {
    process.env.CRON_SECRET = 'segredo-cron-teste';
    expect((await cron.fetch(new Request('https://x/api/cron'))).status).toBe(401);
    const ok = await cron.fetch(new Request('https://x/api/cron', { headers: { authorization: 'Bearer segredo-cron-teste' } }));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toHaveProperty('maintenance');
  });
});
