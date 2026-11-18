// EST/LOJ: catálogo, unidades, movimentos e permissões no PostgreSQL real.
import { beforeAll, describe, expect, it } from 'vitest';
import { admin, call, makeUser, type TestUser } from '../support/harness';

let owner: TestUser, seller: TestUser;
beforeAll(async () => { owner = await makeUser('OWNER'); seller = await makeUser('SELLER'); });

const create = (body: object, u = owner) => call('POST', '/api/v1/catalog/products', { user: u, body });
const get = async (id: string, u = owner) => (await call('GET', `/api/v1/catalog/products/${id}`, { user: u })).body.data;

describe('cadastro com quantidade inicial', () => {
  it('3 bikes sem série → 3 unidades internas, 3 movimentos RECEIPT, disponível 3', async () => {
    const r = await create({ name: 'Caloi Elite Carbon', initial_quantity: 3, sale_price_cents: '1290000', acquisition_cost_cents: '850000' });
    expect(r.status).toBe(201);
    const p = await get(r.body.data.id);
    expect(p.type).toBe('BIKE');
    expect(p.sku).toMatch(/^NB-\d{5}$/);
    expect(p.units).toHaveLength(3);
    expect(p.units.every((u: any) => u.serial_number === null && /^BK-\d{6}$/.test(u.internal_code))).toBe(true);
    expect(p.counts).toMatchObject({ known: true, physical_on_hand: 3, available: 3, reserved: 0 });
    const [{ n }] = await admin`select count(*)::int n from inventory.inventory_movements where product_id = ${r.body.data.id} and kind = 'RECEIPT'`;
    expect(n).toBe(3);
  });

  it('quantidade zero não cria movimento nem unidade fictícia', async () => {
    const r = await create({ name: 'Modelo sem estoque', initial_quantity: 0 });
    const p = await get(r.body.data.id);
    expect(p.units).toEqual([]);
    expect(p.counts.available).toBe(0);
    expect(p.movements).toEqual([]);
  });

  it('série preenchida duplicada é negada (e nada é gravado); série ausente permitida', async () => {
    await create({ name: 'Série A', initial_quantity: 1, initial_units: [{ serial_number: 'WTU-123-XY' }] });
    const dup = await create({ name: 'Série B', initial_quantity: 2, initial_units: [{ serial_number: null }, { serial_number: ' wtu-123-xy ' }] });
    expect(dup.status).toBe(422);
    const [{ n }] = await admin`select count(*)::int n from inventory.products where name = 'Série B'`;
    expect(n).toBe(0);
  });

  it('acessório usa saldo por quantidade; custo ausente fica null (não zero)', async () => {
    const r = await create({ name: 'Câmara 29', type: 'ACCESSORY', initial_quantity: 10, sale_price_cents: '4990' });
    const p = await get(r.body.data.id);
    expect(p.counts).toMatchObject({ physical_on_hand: 10, available: 10 });
    expect(p.reference_cost_cents).toBeNull();
    expect(p.units).toBeNull();
  });

  it('mesma Idempotency-Key não duplica produto nem entrada', async () => {
    const key = crypto.randomUUID();
    const body = { name: 'Idem Bike', initial_quantity: 2 };
    const a = await call('POST', '/api/v1/catalog/products', { user: owner, key, body });
    const b = await call('POST', '/api/v1/catalog/products', { user: owner, key, body });
    expect(b.body.data.id).toBe(a.body.data.id);
    const [{ n }] = await admin`select count(*)::int n from inventory.inventory_units u join inventory.products p on p.id = u.product_id where p.name = 'Idem Bike'`;
    expect(n).toBe(2);
  });
});

describe('vendedora consulta sem custo e não altera estoque', () => {
  it('projeção SELLER sem custo/fornecedor/movimentos; escrita negada', async () => {
    const r = await create({ name: 'Oggi 7.2', initial_quantity: 1, sale_price_cents: '650000', acquisition_cost_cents: '400000' });
    const p = await get(r.body.data.id, seller);
    expect(p).not.toHaveProperty('reference_cost_cents');
    expect(p.units[0]).not.toHaveProperty('acquisition_cost_cents');
    expect(p.movements).toBeNull();
    expect(p.sale_price_cents).toBe('650000');
    expect(JSON.stringify(p)).not.toContain('400000');
    const list = await call('GET', '/api/v1/catalog/products?q=Oggi', { user: seller });
    expect(JSON.stringify(list.body)).not.toContain('400000');
    const w = await call('POST', '/api/v1/inventory/receipts', { user: seller, body: { product_id: r.body.data.id, expected_inventory_version: 1, quantity: 1, reason: 'x' } });
    expect(w.status).toBe(403);
    const patch = await call('PATCH', `/api/v1/catalog/products/${r.body.data.id}`, { user: seller, body: { expected_version: 1, sale_price_cents: '1' } });
    expect(patch.status).toBe(403);
  });
});

describe('entradas, ajustes e recontagem', () => {
  it('entradas concorrentes com a mesma versão de estoque: uma grava, outra 409', async () => {
    const r = await create({ name: 'Concorrente', initial_quantity: 0 });
    const v = (await get(r.body.data.id)).inventory_version;
    const body = { product_id: r.body.data.id, expected_inventory_version: v, quantity: 1, reason: 'Compra NF 10' };
    const [a, b] = await Promise.all([
      call('POST', '/api/v1/inventory/receipts', { user: owner, body }),
      call('POST', '/api/v1/inventory/receipts', { user: owner, body }),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect((await get(r.body.data.id)).units).toHaveLength(1);
  });

  it('baixa de bike exige identificar a unidade; recontagem registra diferença compensatória', async () => {
    const r = await create({ name: 'Recontar', initial_quantity: 3 });
    let p = await get(r.body.data.id);
    const noIds = await call('POST', '/api/v1/inventory/adjustments', { user: owner, body: { product_id: p.id, expected_inventory_version: p.inventory_version, quantity_delta: -1, reason: 'Avaria' } });
    expect(noIds.status).toBe(422);
    const adj = await call('POST', '/api/v1/inventory/adjustments', { user: owner, body: { product_id: p.id, expected_inventory_version: p.inventory_version, quantity_delta: -1, unit_ids: [p.units[0].id], reason: 'Avaria' } });
    expect(adj.status).toBe(201);
    p = await get(p.id);
    expect(p.counts.physical_on_hand).toBe(2);
    const rc = await call('POST', '/api/v1/inventory/recounts', { user: owner, body: { product_id: p.id, expected_inventory_version: p.inventory_version, counted_quantity: 1, observed_unit_ids: [p.units[0].id], reason: 'Inventário mensal' } });
    expect(rc.status).toBe(201);
    expect(rc.body.data.difference).toBe(-1);
    p = await get(p.id);
    expect(p.counts.physical_on_hand).toBe(1);
    expect(p.movements.map((m: any) => m.kind)).toEqual(expect.arrayContaining(['RECEIPT', 'ADJUSTMENT_OUT', 'RECOUNT_OUT']));
  });

  it('acessório não fica negativo', async () => {
    const r = await create({ name: 'Bomba', type: 'ACCESSORY', initial_quantity: 2 });
    const p = await get(r.body.data.id);
    const adj = await call('POST', '/api/v1/inventory/adjustments', { user: owner, body: { product_id: p.id, expected_inventory_version: p.inventory_version, quantity_delta: -3, reason: 'x' } });
    expect(adj.status).toBe(409);
    expect((await get(p.id)).counts.physical_on_hand).toBe(2);
  });

  it('identificação de série depois do cadastro; duplicada negada', async () => {
    const r = await create({ name: 'Identificar', initial_quantity: 2 });
    const p = await get(r.body.data.id);
    const ok = await call('PATCH', `/api/v1/inventory/units/${p.units[0].id}/identification`, { user: owner, body: { expected_version: 1, serial_number: 'ABC-999' } });
    expect(ok.status).toBe(200);
    const dup = await call('PATCH', `/api/v1/inventory/units/${p.units[1].id}/identification`, { user: owner, body: { expected_version: 1, serial_number: 'abc-999' } });
    expect(dup.status).toBe(422);
  });

  it('PATCH de produto não aceita quantidade/saldo; arquivar bloqueia entrada', async () => {
    const r = await create({ name: 'Arquivar', initial_quantity: 0 });
    expect((await call('PATCH', `/api/v1/catalog/products/${r.body.data.id}`, { user: owner, body: { expected_version: 1, available: 5 } })).status).toBe(422);
    expect((await call('POST', `/api/v1/catalog/products/${r.body.data.id}/archive`, { user: owner, body: { expected_version: 1, reason: 'Fora de linha' } })).status).toBe(200);
    const p = await get(r.body.data.id);
    const rec = await call('POST', '/api/v1/inventory/receipts', { user: owner, body: { product_id: p.id, expected_inventory_version: p.inventory_version, quantity: 1, reason: 'x' } });
    expect(rec.status).toBe(422);
  });
});

describe('fotos', () => {
  it('sem Storage configurado → capacidade indisponível (nunca sucesso fictício)', async () => {
    const r = await create({ name: 'Com foto', initial_quantity: 0 });
    const a = await call('POST', '/api/v1/attachments', { user: owner, body: { product_id: r.body.data.id, content_type: 'image/png', size_bytes: 100 } });
    expect(a.status).toBe(503);
    expect(a.body.code).toBe('CAPABILITY_UNAVAILABLE');
  });
});
