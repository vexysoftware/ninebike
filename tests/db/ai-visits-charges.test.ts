// IA registra visitas e cobranças; atribuição de clientes e relatório de comissão da operadora da IA.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, call, makeUser, randomMobile, type TestUser } from '../support/harness';

let owner: TestUser, seller: TestUser, token: string;
const today = new Date().toISOString().slice(0, 10);
const tomorrow = new Date(Date.now() + 86400000).toISOString();
const ag = (method: string, path: string, body?: unknown) => call(method, path, { token, body, key: null });

beforeAll(async () => {
  owner = await makeUser('OWNER'); seller = await makeUser('SELLER');
  await admin`update crm.settings set default_lead_owner_id = ${seller.id}`;
  const [{ n }] = await admin`select count(*)::int n from identity.commercial_policies`;
  if (n === 0) await call('POST', '/api/v1/admin/policy-versions', { user: owner, body: { expected_revision: 0, reservation_minutes: 120, quote_validity_minutes: 2880, seller_max_discount_bps: 500 } });
  token = (await call('POST', '/api/v1/admin/agent-clients', { user: owner, body: { name: 'IA', scopes: ['leads.write', 'visits.write', 'payments.write'] } })).body.data.token;
});
afterAll(async () => { await admin`update crm.settings set default_lead_owner_id = null`; });

async function sellTo(contactId: string, price = '1000000') {
  const p = (await call('POST', '/api/v1/catalog/products', { user: owner, body: { name: `Bike ${Math.random()}`, initial_quantity: 1, sale_price_cents: price } })).body.data.id;
  const q = (await call('POST', '/api/v1/quotes', { user: seller, body: { contact_id: contactId, items: [{ product_id: p, quantity: 1 }] } })).body.data.id;
  await call('POST', '/api/v1/reservations', { user: seller, body: { quote_id: q, quote_version: 1 } });
  return (await call('POST', '/api/v1/orders', { user: seller, body: { quote_id: q, quote_version: 1, allocations: [{ mode: 'PIX', principal_cents: price, due_date: today }] } })).body.data.id as string;
}

describe('visitas pela IA', () => {
  it('cria contato atribuído, visita e tarefa; idempotente; vendedora marca comparecimento', async () => {
    const mobile = randomMobile();
    const body = { event_id: crypto.randomUUID(), mobile_phone: mobile, name: 'Ana Visita', scheduled_at: tomorrow, note: 'Quer testar a aro 29' };
    const v = await ag('POST', '/agent/v1/visits', body);
    expect(v.status).toBe(201);
    expect((await ag('POST', '/agent/v1/visits', body)).body.data.replayed).toBe(true);
    const [a] = await admin`select first_reason from integrations.ai_attributions where contact_id = ${v.body.data.contact_id}`;
    expect(a.first_reason).toBe('VISIT');
    const list = await call('GET', '/api/v1/visits', { user: seller });
    const mine = list.body.data.find((x: any) => x.id === v.body.data.id);
    expect(mine).toMatchObject({ state: 'SCHEDULED', source: 'whatsapp_ai' });
    expect((await call('POST', `/api/v1/visits/${mine.id}/state`, { user: seller, body: { expected_version: 1, state: 'ATTENDED' } })).status).toBe(200);
    // IA não mexe em visita já concluída
    expect((await ag('PATCH', `/agent/v1/visits/${mine.id}`, { state: 'CANCELLED' })).status).toBe(409);
  });
  it('sem escopo visits.write → 403', async () => {
    const t = (await call('POST', '/api/v1/admin/agent-clients', { user: owner, body: { name: 'só leitura', scopes: ['catalog.read'] } })).body.data.token;
    expect((await call('POST', '/agent/v1/visits', { token: t, key: null, body: { event_id: crypto.randomUUID(), mobile_phone: randomMobile(), name: 'x', scheduled_at: tomorrow } })).status).toBe(403);
  });
});

describe('cobranças e comissão da IA', () => {
  it('Pix gerado → pago informado → dono confirma; venda de cliente atribuído entra no relatório', async () => {
    await call('POST', '/api/v1/admin/ai-commission-rules', { user: owner, body: { expected_version: 0, bps: 500, window_days: 90 } });
    const mobile = randomMobile();
    const ext = `pay_${Math.random().toString(36).slice(2)}`;
    const ch = await ag('POST', '/agent/v1/charges', { event_id: crypto.randomUUID(), mobile_phone: mobile, name: 'Bruno Pix', kind: 'PIX', provider: 'Asaas', external_id: ext, amount_cents: '50000', description: 'Sinal da bike' });
    expect(ch.status).toBe(201);
    expect((await ag('POST', '/agent/v1/charges/status', { provider: 'asaas', external_id: ext, state: 'PAID_REPORTED' })).body.data.state).toBe('PAID_REPORTED');
    // repetição do webhook não quebra
    expect((await ag('POST', '/agent/v1/charges/status', { provider: 'asaas', external_id: ext, state: 'PAID_REPORTED' })).status).toBe(200);
    expect((await call('POST', `/api/v1/ai-charges/${ch.body.data.id}/review`, { user: seller, body: { expected_version: 2, confirmation: 'CONFIRMED' } })).status).toBe(403);

    let rep = (await call('GET', '/api/v1/reports/ai', { user: owner })).body.data;
    expect(rep.paid_charges_without_order.some((x: any) => x.id === ch.body.data.id && x.confirmation === 'PENDING')).toBe(true);

    expect((await call('POST', `/api/v1/ai-charges/${ch.body.data.id}/review`, { user: owner, body: { expected_version: 2, confirmation: 'CONFIRMED' } })).status).toBe(200);
    const order = await sellTo(ch.body.data.contact_id, '1000000');
    rep = (await call('GET', '/api/v1/reports/ai', { user: owner })).body.data;
    expect(rep.orders.some((o: any) => o.order_id === order && o.reason === 'PAYMENT')).toBe(true);
    expect(rep.rule).toMatchObject({ bps: 500, window_days: 90 });
    expect(BigInt(rep.commission_confirmed_cents)).toBeGreaterThanOrEqual(52500n); // 5% de (10.000 + 500)
    expect((await call('GET', '/api/v1/reports/ai', { user: seller })).status).toBe(403);
  });

  it('cliente antigo com compra anterior não é reivindicado pela IA', async () => {
    const c = (await call('POST', '/api/v1/contacts', { user: seller, body: { name: 'Cliente da loja', mobile_phone: randomMobile() } })).body.data;
    await sellTo(c.id, '300000');
    const mobile = (await admin`select mobile_e164 m from crm.contacts where id = ${c.id}`)[0].m;
    await ag('POST', '/agent/v1/visits', { event_id: crypto.randomUUID(), mobile_phone: mobile, scheduled_at: tomorrow });
    const rows = await admin`select 1 from integrations.ai_attributions where contact_id = ${c.id}`;
    expect(rows).toHaveLength(0);
  });
});
