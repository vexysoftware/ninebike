// T04/T05: proposta → reserva → pedido atômico com obrigações e comissão; concorrência com sessões reais.
import { beforeAll, describe, expect, it } from 'vitest';
import { admin, call, makeUser, randomMobile, type TestUser } from '../support/harness';

let owner: TestUser, seller: TestUser;
const today = new Date().toISOString().slice(0, 10);

async function contact(u: TestUser) {
  return (await call('POST', '/api/v1/contacts', { user: u, body: { name: `Cliente ${Math.random()}`, mobile_phone: randomMobile() } })).body.data.id as string;
}
async function bike(qty: number, price = '800000', cost: string | null = '500000') {
  const r = await call('POST', '/api/v1/catalog/products', { user: owner, body: { name: `Bike ${Math.random()}`, initial_quantity: qty, sale_price_cents: price, ...(cost ? { acquisition_cost_cents: cost } : {}) } });
  return r.body.data.id as string;
}
async function quote(u: TestUser, items: object[], contactId?: string) {
  const r = await call('POST', '/api/v1/quotes', { user: u, body: { contact_id: contactId ?? (await contact(u)), items } });
  return r;
}

beforeAll(async () => {
  owner = await makeUser('OWNER'); seller = await makeUser('SELLER');
  const [{ n }] = await admin`select count(*)::int n from identity.commercial_policies`;
  if (n === 0) expect((await call('POST', '/api/v1/admin/policy-versions', { user: owner, body: { expected_revision: 0, reservation_minutes: 120, quote_validity_minutes: 2880, seller_max_discount_bps: 500 } })).status).toBe(201);
});

describe('proposta', () => {
  it('preço vem do catálogo, não do cliente; sem preço não entra', async () => {
    const p = await bike(1, '1290000');
    const r = await quote(seller, [{ product_id: p, quantity: 1 }]);
    expect(r.status).toBe(201);
    const g = await call('GET', `/api/v1/quotes/${r.body.data.id}`, { user: seller });
    expect(g.body.data.total_cents).toBe('1290000');
    const noPrice = (await call('POST', '/api/v1/catalog/products', { user: owner, body: { name: 'Sem preço', initial_quantity: 1 } })).body.data.id;
    expect((await quote(seller, [{ product_id: noPrice, quantity: 1 }])).status).toBe(422);
    expect((await quote(seller, [{ product_id: p, quantity: 1, unit_price_cents: '1' }])).status).toBe(422);
  });
  it('desconto acima da alçada da vendedora exige aprovação; dentro da alçada passa; OWNER pode', async () => {
    const p = await bike(1, '1000000');
    expect((await quote(seller, [{ product_id: p, quantity: 1, discount_cents: '60000' }])).body.code).toBe('APPROVAL_REQUIRED');
    expect((await quote(seller, [{ product_id: p, quantity: 1, discount_cents: '50000' }])).status).toBe(201);
    expect((await quote(owner, [{ product_id: p, quantity: 1, discount_cents: '60000' }])).status).toBe(201);
  });
  it('revisão cria nova versão e preserva a anterior', async () => {
    const p = await bike(1);
    const c = await contact(seller);
    const q1 = (await quote(seller, [{ product_id: p, quantity: 1 }], c)).body.data.id;
    const r = await call('PATCH', `/api/v1/quotes/${q1}`, { user: seller, body: { expected_version: 1, contact_id: c, items: [{ product_id: p, quantity: 1, discount_cents: '10000' }] } });
    expect(r.status).toBe(200);
    const g = await call('GET', `/api/v1/quotes/${r.body.data.id}`, { user: seller });
    expect(g.body.data.revisions.map((x: any) => [x.revision, x.state])).toEqual([[1, 'SUPERSEDED'], [2, 'DRAFT']]);
  });
});

describe('reserva e pedido', () => {
  it('disputa pela última bike: duas reservas simultâneas, só uma fica ativa', async () => {
    const p = await bike(1);
    const [a, b] = await Promise.all([quote(seller, [{ product_id: p, quantity: 1 }]), quote(owner, [{ product_id: p, quantity: 1 }])]);
    const [ra, rb] = await Promise.all([
      call('POST', '/api/v1/reservations', { user: seller, body: { quote_id: a.body.data.id, quote_version: 1 } }),
      call('POST', '/api/v1/reservations', { user: owner, body: { quote_id: b.body.data.id, quote_version: 1 } }),
    ]);
    expect([ra.status, rb.status].sort()).toEqual([201, 409]);
    const [{ n }] = await admin`select count(*)::int n from inventory.stock_reservations s join inventory.inventory_units u on u.id = s.unit_id where u.product_id = ${p} and s.state = 'ACTIVE'`;
    expect(n).toBe(1);
  });

  it('confirmação atômica: pedido, compromisso das unidades, obrigações e comissão 1,5% que fecha o alvo', async () => {
    const p = await bike(2, '800000');
    const q = (await quote(seller, [{ product_id: p, quantity: 2 }])).body.data.id; // total 1.600.000
    await call('POST', '/api/v1/reservations', { user: seller, body: { quote_id: q, quote_version: 1 } });
    const bad = await call('POST', '/api/v1/orders', { user: seller, body: { quote_id: q, quote_version: 1, allocations: [{ mode: 'PIX', principal_cents: '1000000', due_date: today }] } });
    expect(bad.status).toBe(422);
    const r = await call('POST', '/api/v1/orders', { user: seller, body: { quote_id: q, quote_version: 1, allocations: [
      { mode: 'PIX', principal_cents: '400033', due_date: today }, { mode: 'CARD', principal_cents: '1199967', due_date: today, installment_count: 3 }] } });
    expect(r.status).toBe(201);
    const id = r.body.data.id;
    const [o] = await admin`select commission_target_cents, coverage_state from sales.orders where id = ${id}`;
    expect(o).toMatchObject({ commission_target_cents: '24000', coverage_state: 'NONE' });
    const [{ s }] = await admin`select sum(c.original_commission_cents)::text s from finance.commission_allocations c join finance.payment_allocations a on a.id = c.payment_allocation_id where a.order_id = ${id}`;
    expect(s).toBe('24000');
    const units = await admin`select state from inventory.inventory_units where product_id = ${p}`;
    expect(units.map((u) => u.state)).toEqual(['COMMITTED', 'COMMITTED']);
    const items = await admin`select cost_snapshot_cents::text c from sales.order_items where order_id = ${id}`;
    expect(items.map((i) => i.c)).toEqual(['500000', '500000']);
  });

  it('duas confirmações da mesma proposta com chaves diferentes: um pedido só', async () => {
    const p = await bike(1);
    const q = (await quote(seller, [{ product_id: p, quantity: 1 }])).body.data.id;
    await call('POST', '/api/v1/reservations', { user: seller, body: { quote_id: q, quote_version: 1 } });
    const body = { quote_id: q, quote_version: 1, allocations: [{ mode: 'PIX', principal_cents: '800000', due_date: today }] };
    const rs = await Promise.all([call('POST', '/api/v1/orders', { user: seller, body }), call('POST', '/api/v1/orders', { user: seller, body })]);
    expect(rs.map((r) => r.status).sort()).toEqual([201, 409]);
    const [{ n }] = await admin`select count(*)::int n from sales.orders where quote_id = ${q}`;
    expect(n).toBe(1);
  });

  it('sem reserva ativa não confirma; custo desconhecido fica null', async () => {
    const p = await bike(1, '800000', null);
    const q = (await quote(seller, [{ product_id: p, quantity: 1 }])).body.data.id;
    const body = { quote_id: q, quote_version: 1, allocations: [{ mode: 'PIX', principal_cents: '800000', due_date: today }] };
    expect((await call('POST', '/api/v1/orders', { user: seller, body })).status).toBe(409);
    await call('POST', '/api/v1/reservations', { user: seller, body: { quote_id: q, quote_version: 1 } });
    const r = await call('POST', '/api/v1/orders', { user: seller, body });
    const [i] = await admin`select cost_snapshot_cents from sales.order_items where order_id = ${r.body.data.id}`;
    expect(i.cost_snapshot_cents).toBeNull();
  });

  it('Registro de vendas: vendedora vê só a carteira, sem custo; OWNER cancela e o estoque volta', async () => {
    const p = await bike(1);
    const q = (await quote(owner, [{ product_id: p, quantity: 1 }])).body.data.id;
    await call('POST', '/api/v1/reservations', { user: owner, body: { quote_id: q, quote_version: 1 } });
    const o = (await call('POST', '/api/v1/orders', { user: owner, body: { quote_id: q, quote_version: 1, allocations: [{ mode: 'BOLETO', principal_cents: '800000', due_date: today }] } })).body.data.id;
    expect((await call('GET', `/api/v1/orders/${o}`, { user: seller })).status).toBe(404);
    const mine = await call('GET', '/api/v1/orders?limit=100', { user: seller });
    expect(mine.body.data.every((x: any) => x.seller.id === seller.id)).toBe(true);
    expect(JSON.stringify(mine.body)).not.toContain('cost_snapshot');
    const det = await call('GET', `/api/v1/orders/${o}`, { user: owner });
    expect(det.body.data.items[0].cost_snapshot_cents).toBe('500000');
    expect((await call('POST', '/api/v1/orders/' + o + '/deliveries', { user: owner, body: {} })).status).toBe(503);
    expect((await call('POST', `/api/v1/orders/${o}/cancellations`, { user: seller, body: { expected_version: 1, reason: 'x' } })).status).toBe(403);
    expect((await call('POST', `/api/v1/orders/${o}/cancellations`, { user: owner, body: { expected_version: 1, reason: 'Cliente desistiu' } })).status).toBe(200);
    const [u] = await admin`select state from inventory.inventory_units where product_id = ${p}`;
    expect(u.state).toBe('IN_STOCK');
  });
});
