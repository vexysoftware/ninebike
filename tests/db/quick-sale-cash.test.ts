// Venda rápida (proposta+reserva+pedido numa transação) e caixa do dia.
import { beforeAll, describe, expect, it } from 'vitest';
import { admin, call, makeUser, randomMobile, type TestUser } from '../support/harness';

let owner: TestUser, seller: TestUser;
beforeAll(async () => {
  owner = await makeUser('OWNER'); seller = await makeUser('SELLER');
  const [{ n }] = await admin`select count(*)::int n from identity.commercial_policies`;
  if (n === 0) await call('POST', '/api/v1/admin/policy-versions', { user: owner, body: { expected_revision: 0, reservation_minutes: 120, quote_validity_minutes: 2880, seller_max_discount_bps: 500 } });
  await admin`delete from finance.cash_entries where session_id in (select id from finance.cash_sessions where business_date = (now() at time zone 'America/Sao_Paulo')::date)`;
  await admin`delete from finance.cash_sessions where business_date = (now() at time zone 'America/Sao_Paulo')::date`;
});
const bike = async (price: string) => (await call('POST', '/api/v1/catalog/products', { user: owner, body: { name: `Bike ${Math.random()}`, initial_quantity: 1, sale_price_cents: price } })).body.data.id as string;
const contact = async () => (await call('POST', '/api/v1/contacts', { user: seller, body: { name: 'Balcão', mobile_phone: randomMobile() } })).body.data.id as string;

describe('venda rápida + caixa', () => {
  it('abre caixa, vende com Pix + dinheiro (sinal), recebe o restante, fecha com diferença', async () => {
    expect((await call('POST', '/api/v1/cash/open', { user: seller, body: { opening_cents: '20000' } })).status).toBe(200);
    const p = await bike('500000'); const c = await contact();
    const bad = await call('POST', '/api/v1/quick-sales', { user: seller, body: { contact_id: c, items: [{ product_id: p, quantity: 1 }], payments: [{ method: 'PIX', amount_cents: '100000' }] } });
    expect(bad.status).toBe(422);
    const [{ st }] = await admin`select count(*)::int st from inventory.inventory_units where product_id = ${p} and state = 'IN_STOCK'`;
    expect(st).toBe(1); // falha desfez tudo
    const r = await call('POST', '/api/v1/quick-sales', { user: seller, body: { contact_id: c, items: [{ product_id: p, quantity: 1 }], payments: [
      { method: 'PIX', amount_cents: '300000', received: true }, { method: 'CASH', amount_cents: '50000', received: true }, { method: 'CREDIT', amount_cents: '150000', installments: 10 }] } });
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ total_cents: '500000', received_cents: '350000' });
    const [{ s }] = await admin`select state s from inventory.inventory_units where product_id = ${p}`;
    expect(s).toBe('COMMITTED');
    const rec = await call('POST', `/api/v1/orders/${r.body.data.id}/receipts`, { user: seller, body: { method: 'CREDIT', amount_cents: '150000', installments: 10 } });
    expect(rec.body.data.open_cents).toBe('0');
    expect((await call('POST', `/api/v1/orders/${r.body.data.id}/receipts`, { user: seller, body: { method: 'CASH', amount_cents: '1' } })).status).toBe(422);
    await call('POST', '/api/v1/cash/entries', { user: seller, body: { direction: 'OUT', kind: 'WITHDRAWAL', method: 'CASH', amount_cents: '30000', description: 'Sangria' } });
    const day = (await call('GET', '/api/v1/cash', { user: seller })).body.data;
    expect(day.expected_cash_now_cents).toBe('40000'); // 200 + 500 - 300
    const close = await call('POST', '/api/v1/cash/close', { user: seller, body: { counted_cents: '39000' } });
    expect(close.body.data).toMatchObject({ expected_cash_cents: '40000', difference_cents: '-1000' });
    expect((await call('POST', '/api/v1/cash/entries', { user: seller, body: { direction: 'IN', kind: 'OTHER', method: 'CASH', amount_cents: '100', description: 'x' } })).status).toBe(409);
    expect((await call('POST', '/api/v1/cash/reopen', { user: seller, body: {} })).status).toBe(403);
    expect((await call('POST', '/api/v1/cash/reopen', { user: owner, body: {} })).status).toBe(200);
  });
});
