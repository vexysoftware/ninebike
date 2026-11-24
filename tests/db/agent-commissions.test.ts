// IA do WhatsApp (n8n) por chave de API com escopo, e comissão da equipe (T16).
import { beforeAll, describe, expect, it } from 'vitest';
import { admin, call, makeUser, randomMobile, type TestUser } from '../support/harness';

let owner: TestUser, seller: TestUser;
const today = new Date().toISOString().slice(0, 10);

async function newKey(scopes: string[]) {
  const r = await call('POST', '/api/v1/admin/agent-clients', { user: owner, body: { name: 'IA WhatsApp', scopes } });
  expect(r.status).toBe(201);
  return { id: r.body.data.id as string, token: r.body.data.token as string };
}
async function sell(u: TestUser, price: string) {
  const p = (await call('POST', '/api/v1/catalog/products', { user: owner, body: { name: `Bike ${Math.random()}`, initial_quantity: 1, sale_price_cents: price, acquisition_cost_cents: '100' } })).body.data.id;
  const c = (await call('POST', '/api/v1/contacts', { user: u, body: { name: 'Comprador', mobile_phone: randomMobile() } })).body.data.id;
  const q = (await call('POST', '/api/v1/quotes', { user: u, body: { contact_id: c, items: [{ product_id: p, quantity: 1 }] } })).body.data.id;
  await call('POST', '/api/v1/reservations', { user: u, body: { quote_id: q, quote_version: 1 } });
  const o = await call('POST', '/api/v1/orders', { user: u, body: { quote_id: q, quote_version: 1, allocations: [{ mode: 'PIX', principal_cents: price, due_date: today }] } });
  expect(o.status).toBe(201);
  return o.body.data.id as string;
}

beforeAll(async () => {
  owner = await makeUser('OWNER'); seller = await makeUser('SELLER');
  const [{ n }] = await admin`select count(*)::int n from identity.commercial_policies`;
  if (n === 0) await call('POST', '/api/v1/admin/policy-versions', { user: owner, body: { expected_revision: 0, reservation_minutes: 120, quote_validity_minutes: 2880, seller_max_discount_bps: 500 } });
});

describe('integração IA (n8n)', () => {
  it('só OWNER cria chave; MFA exigida; segredo devolvido uma vez e guardado só como hash', async () => {
    expect((await call('POST', '/api/v1/admin/agent-clients', { user: seller, body: { name: 'x', scopes: ['catalog.read'] } })).status).toBe(403);
    expect((await call('POST', '/api/v1/admin/agent-clients', { token: owner.tokenNoMfa, body: { name: 'x', scopes: ['catalog.read'] } })).status).toBe(403);
    const k = await newKey(['catalog.read']);
    expect(k.token).toMatch(/^nbk_/);
    const [row] = await admin`select token_hash from integrations.agent_clients where id = ${k.id}`;
    expect(row.token_hash).not.toContain(k.token);
    const list = await call('GET', '/api/v1/admin/agent-clients', { user: owner });
    expect(JSON.stringify(list.body)).not.toContain(k.token);
  });

  it('consulta de produtos: preço e disponibilidade, nunca custo/fornecedor/unidades', async () => {
    const k = await newKey(['catalog.read']);
    const tag = `Voltz${Math.random().toString(36).slice(2, 7)}`;
    await call('POST', '/api/v1/catalog/products', { user: owner, body: { name: `Bike elétrica ${tag}`, initial_quantity: 2, sale_price_cents: '1249990', acquisition_cost_cents: '700000' } });
    const r = await call('GET', `/agent/v1/products?q=${tag}`, { token: k.token });
    expect(r.status).toBe(200);
    expect(r.body.data).toHaveLength(1);
    expect(r.body.data[0]).toMatchObject({ price_cents: '1249990', price_display: 'R$ 12.499,90', stock: { known: true, available: 2, in_stock: true } });
    expect(JSON.stringify(r.body)).not.toMatch(/cost|supplier|700000|units/);
  });

  it('sem chave, chave inválida, revogada ou sem escopo → negado', async () => {
    expect((await call('GET', '/agent/v1/products')).status).toBe(401);
    expect((await call('GET', '/agent/v1/products', { token: 'nbk_' + 'a'.repeat(40) })).status).toBe(401);
    expect((await call('GET', '/agent/v1/products', { user: owner })).status).toBe(401); // JWT humano não vale aqui
    const k = await newKey(['catalog.read']);
    expect((await call('GET', '/agent/v1/customers/by-phone?phone=11999998888', { token: k.token })).status).toBe(403);
    expect((await call('POST', `/api/v1/admin/agent-clients/${k.id}/revoke`, { user: owner })).status).toBe(200);
    expect((await call('GET', '/agent/v1/products', { token: k.token })).status).toBe(401);
  });

  it('lead do WhatsApp: cria contato+oportunidade; mesmo celular reaproveita; event_id idempotente', async () => {
    await admin`update crm.settings set default_lead_owner_id = ${seller.id}`;
    try {
      const k = await newKey(['leads.write', 'customers.read']);
      const mobile = randomMobile();
      const jid = `${mobile.replace('+', '')}@s.whatsapp.net`;
      const ev = crypto.randomUUID();
      const body = { event_id: ev, name: 'Marcos Pedal', mobile_phone: jid, note: 'Quer bike elétrica até 10 mil, aro 26' };
      const a = await call('POST', '/agent/v1/leads', { token: k.token, body });
      expect(a.status).toBe(201);
      expect(a.body.data.created_contact).toBe(true);
      const again = await call('POST', '/agent/v1/leads', { token: k.token, body });
      expect(again.status).toBe(200);
      expect(again.body.data.replayed).toBe(true);
      expect((await call('POST', '/agent/v1/leads', { token: k.token, body: { ...body, note: 'outra' } })).status).toBe(409);
      const b = await call('POST', '/agent/v1/leads', { token: k.token, body: { ...body, event_id: crypto.randomUUID(), note: 'Voltou perguntando de parcelamento' } });
      expect(b.body.data).toMatchObject({ contact_id: a.body.data.contact_id, opportunity_id: a.body.data.opportunity_id, created_contact: false });
      const [{ n }] = await admin`select count(*)::int n from crm.activities where opportunity_id = ${a.body.data.opportunity_id}`;
      expect(n).toBe(2);
      const who = await call('GET', `/agent/v1/customers/by-phone?phone=${encodeURIComponent(jid)}`, { token: k.token });
      expect(who.body.data).toMatchObject({ found: true, customer: { name: 'Marcos Pedal', first_name: 'Marcos', seller_name: expect.any(String) } });
      expect(who.body.data.customer.open_opportunities).toHaveLength(1);
      expect(JSON.stringify(who.body)).not.toMatch(/cpf|email|address/);
      expect((await call('GET', '/agent/v1/customers/by-phone?phone=11900000001', { token: k.token })).body.data).toEqual({ found: false });
    } finally {
      await admin`update crm.settings set default_lead_owner_id = null`;
    }
  });
});

describe('comissão da equipe', () => {
  it('sem regra não há valor presumido; com regra: padrão, exceção por vendedor e estorno no cancelamento', async () => {
    const [{ n }] = await admin`select count(*)::int n from finance.staff_commission_rules`;
    if (n === 0) {
      const before = await sell(seller, '500000');
      const [{ c }] = await admin`select count(*)::int c from finance.staff_commission_entries where order_id = ${before}`;
      expect(c).toBe(0);
    }
    expect((await call('POST', '/api/v1/admin/staff-commission-rules', { user: seller, body: { expected_version: n, default_bps: 100 } })).status).toBe(403);
    const rule = await call('POST', '/api/v1/admin/staff-commission-rules', { user: owner, body: { expected_version: n, default_bps: 100, overrides: [{ profile_id: seller.id, bps: 250 }] } });
    expect(rule.status).toBe(201);
    expect((await call('POST', '/api/v1/admin/staff-commission-rules', { user: owner, body: { expected_version: n, default_bps: 1 } })).status).toBe(409);

    const o1 = await sell(seller, '1000000'); // 2,5% de 10.000,00 = 250,00
    const o2 = await sell(owner, '1000000'); // 1% padrão
    const mine = await call('GET', `/api/v1/staff-commissions?seller_id=${owner.id}`, { user: seller });
    expect(mine.body.data.entries.every((e: any) => e.seller_id === seller.id)).toBe(true); // filtro ignorado p/ SELLER
    expect(mine.body.data.entries.find((e: any) => e.order_id === o1)).toMatchObject({ amount_cents: '25000', bps: 250, state: 'ACCRUED' });
    const all = await call('GET', '/api/v1/staff-commissions', { user: owner });
    expect(all.body.data.entries.find((e: any) => e.order_id === o2)).toMatchObject({ amount_cents: '10000', bps: 100 });

    await call('POST', `/api/v1/orders/${o1}/cancellations`, { user: owner, body: { reason: 'Desistiu', expected_version: 1 } });
    const [e1] = await admin`select state from finance.staff_commission_entries where order_id = ${o1}`;
    expect(e1.state).toBe('REVERSED');

    const id2 = all.body.data.entries.find((e: any) => e.order_id === o2).id;
    expect((await call('POST', '/api/v1/staff-commissions/payments', { user: seller, body: { entry_ids: [id2] } })).status).toBe(403);
    expect((await call('POST', '/api/v1/staff-commissions/payments', { user: owner, body: { entry_ids: [id2], note: 'Pix 05/12' } })).status).toBe(200);
    expect((await call('POST', '/api/v1/staff-commissions/payments', { user: owner, body: { entry_ids: [id2] } })).status).toBe(409);
  });
});
