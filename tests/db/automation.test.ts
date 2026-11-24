// Automações (tarefas, fila de webhooks assinada, manutenção) e reforços de segurança.
import { beforeAll, describe, expect, it } from 'vitest';
import { Db } from '../../src/adapters/persistence/db';
import { deliverOutbox, isSafeWebhookUrl, sign } from '../../src/modules/integrations/webhooks';
import { admin, apiSql, call, makeApp, makeUser, randomMobile, type TestUser } from '../support/harness';

let owner: TestUser, seller: TestUser;
const db = new Db(apiSql);
const today = new Date().toISOString().slice(0, 10);

async function sell(u: TestUser) {
  const p = (await call('POST', '/api/v1/catalog/products', { user: owner, body: { name: `Bike ${Math.random()}`, initial_quantity: 1, sale_price_cents: '900000' } })).body.data.id;
  const c = (await call('POST', '/api/v1/contacts', { user: u, body: { name: 'Cliente Auto', mobile_phone: randomMobile() } })).body.data.id;
  const q = (await call('POST', '/api/v1/quotes', { user: u, body: { contact_id: c, items: [{ product_id: p, quantity: 1 }] } })).body.data.id;
  await call('POST', '/api/v1/reservations', { user: u, body: { quote_id: q, quote_version: 1 } });
  const o = await call('POST', '/api/v1/orders', { user: u, body: { quote_id: q, quote_version: 1, allocations: [{ mode: 'PIX', principal_cents: '900000', due_date: today }] } });
  expect(o.status).toBe(201);
  return { order: o.body.data.id as string, contact: c as string };
}

beforeAll(async () => {
  owner = await makeUser('OWNER'); seller = await makeUser('SELLER');
  const [{ n }] = await admin`select count(*)::int n from identity.commercial_policies`;
  if (n === 0) await call('POST', '/api/v1/admin/policy-versions', { user: owner, body: { expected_revision: 0, reservation_minutes: 120, quote_validity_minutes: 2880, seller_max_discount_bps: 500 } });
});

describe('tarefas automáticas', () => {
  it('pedido confirmado cria pós-venda em 7 e 30 dias para a vendedora', async () => {
    const { contact } = await sell(seller);
    const rows = await admin`select body, author_id, round(extract(epoch from due_at - now()) / 86400) d from crm.activities where contact_id = ${contact} and kind = 'TASK' order by due_at`;
    expect(rows.map((r) => Number(r.d))).toEqual([7, 30]);
    expect(rows.every((r) => r.author_id === seller.id)).toBe(true);
  });
});

describe('webhooks', () => {
  it('URL interna/sem https é recusada (SSRF)', async () => {
    for (const u of ['http://n8n.exemplo.com/x', 'https://localhost/x', 'https://127.0.0.1/x', 'https://10.0.0.5/x', 'https://192.168.0.2/x', 'https://[::1]/x', 'https://user:pw@n8n.exemplo.com'])
      expect(isSafeWebhookUrl(u), u).toBe(false);
    expect(isSafeWebhookUrl('https://n8n.ninebike.com.br/webhook/abc')).toBe(true);
    const r = await call('POST', '/api/v1/admin/webhooks', { user: owner, body: { name: 'x', url: 'https://127.0.0.1/hook', events: ['order.confirmed'] } });
    expect(r.status).toBe(422);
    expect((await call('POST', '/api/v1/admin/webhooks', { user: seller, body: { name: 'x', url: 'https://n8n.exemplo.com/h', events: ['order.confirmed'] } })).status).toBe(403);
  });

  it('pedido gera evento assinado; falha agenda nova tentativa; sucesso marca entregue', async () => {
    const w = await call('POST', '/api/v1/admin/webhooks', { user: owner, body: { name: 'n8n', url: 'https://n8n.exemplo.com/hook', events: ['order.confirmed'] } });
    expect(w.status).toBe(201);
    const secret = w.body.data.secret as string;
    expect(secret).toMatch(/^whsec_/);
    expect(JSON.stringify((await call('GET', '/api/v1/admin/webhooks', { user: owner })).body)).not.toContain(secret);
    const { order } = await sell(seller);
    const [box] = await admin`select id from integrations.outbox where endpoint_id = ${w.body.data.id} and payload->'data'->>'order_id' = ${order}`;
    expect(box).toBeTruthy();

    const got: Array<{ headers: Headers; body: string }> = [];
    let fail = true;
    const fake = (async (_u: string, init: RequestInit) => {
      got.push({ headers: new Headers(init.headers), body: String(init.body) });
      return new Response(null, { status: fail ? 500 : 204 });
    }) as unknown as typeof fetch;
    // Isola: só o nosso item fica elegível.
    await admin`update integrations.outbox set next_attempt_at = now() + interval '1 day' where id <> ${box.id} and delivered_at is null`;
    await deliverOutbox(db, fake);
    let [s] = await admin`select attempts, delivered_at, next_attempt_at > now() later from integrations.outbox where id = ${box.id}`;
    expect(s).toMatchObject({ attempts: 1, delivered_at: null, later: true });
    await admin`update integrations.outbox set next_attempt_at = now() where id = ${box.id}`;
    fail = false;
    await deliverOutbox(db, fake);
    [s] = await admin`select attempts, delivered_at from integrations.outbox where id = ${box.id}`;
    expect(s.delivered_at).not.toBeNull();

    const last = got[got.length - 1];
    const ts = last.headers.get('x-ninebike-timestamp')!;
    expect(last.headers.get('x-ninebike-signature')).toBe(`sha256=${await sign(secret, ts, last.body)}`);
    const payload = JSON.parse(last.body);
    expect(payload).toMatchObject({ event: 'order.confirmed', delivery_id: box.id, data: { order_id: order } });
    expect(payload.data.items).toHaveLength(1);
    expect(last.body).not.toMatch(/"cpf"|cost_|"email"/);
    await call('POST', `/api/v1/admin/webhooks/${w.body.data.id}/active`, { user: owner, body: { active: false } });
  });

  it('manutenção expira reserva vencida e devolve a bike ao estoque', async () => {
    const p = (await call('POST', '/api/v1/catalog/products', { user: owner, body: { name: `Bike ${Math.random()}`, initial_quantity: 1, sale_price_cents: '100000' } })).body.data.id;
    const c = (await call('POST', '/api/v1/contacts', { user: seller, body: { name: 'Reserva', mobile_phone: randomMobile() } })).body.data.id;
    const q = (await call('POST', '/api/v1/quotes', { user: seller, body: { contact_id: c, items: [{ product_id: p, quantity: 1 }] } })).body.data.id;
    await call('POST', '/api/v1/reservations', { user: seller, body: { quote_id: q, quote_version: 1 } });
    await admin`update inventory.reservation_groups set expires_at = now() - interval '1 minute' where quote_id = ${q}`;
    const r = await db.query<{ reservations_expired: number }>('job_maintenance', []);
    expect(r.reservations_expired).toBeGreaterThanOrEqual(1);
    const [u] = await admin`select state from inventory.inventory_units where product_id = ${p}`;
    expect(u.state).toBe('IN_STOCK');
  });
});

describe('segurança', () => {
  it('chave da IA: IP fora da lista → 403; IP permitido → 200; vencida → 401', async () => {
    const k = await call('POST', '/api/v1/admin/agent-clients', { user: owner, body: { name: 'n8n', scopes: ['catalog.read'], allowed_ips: ['203.0.113.7'], expires_in_days: 30 } });
    expect(k.status).toBe(201);
    const app = makeApp();
    const hit = (ip?: string) => app(new Request('http://localhost/agent/v1/products', { headers: { authorization: `Bearer ${k.body.data.token}`, ...(ip ? { 'cf-connecting-ip': ip } : {}) } }));
    expect((await hit()).status).toBe(403);
    expect((await hit('198.51.100.1')).status).toBe(403);
    expect((await hit('203.0.113.7')).status).toBe(200);
    await admin`update integrations.agent_clients set expires_at = now() - interval '1 second' where id = ${k.body.data.id}`;
    expect((await hit('203.0.113.7')).status).toBe(401);
    expect((await call('POST', '/api/v1/admin/agent-clients', { user: owner, body: { name: 'x', scopes: ['catalog.read'], allowed_ips: ['999.1.1.1'] } })).status).toBe(422);
  });

  it('limite por usuário: acima de 600/min → 429', async () => {
    const u = await makeUser('SELLER');
    await admin`insert into integrations.api_rate (actor_id, window_start, hits) values (${u.id}, date_trunc('minute', now()), 600)`;
    const r = await call('GET', '/api/v1/session', { user: u });
    expect(r.status).toBe(429);
  });
});
