// T10 (parte interna): despesas, parcelas, baixas parciais reversíveis e resultado gerencial com completude.
import { beforeAll, describe, expect, it } from 'vitest';
import { admin, call, makeUser, type TestUser } from '../support/harness';

let owner: TestUser, seller: TestUser, cat: string, tax: string;
const month = '2031-03-01';
beforeAll(async () => {
  owner = await makeUser('OWNER'); seller = await makeUser('SELLER');
  const cats = (await call('GET', '/api/v1/expense-categories', { user: owner })).body.data;
  cat = cats.find((c: any) => c.name === 'Aluguel').id; tax = cats.find((c: any) => c.kind === 'TAX').id;
});

describe('despesas', () => {
  it('vendedora não acessa financeiro', async () => {
    expect((await call('GET', '/api/v1/expenses', { user: seller })).status).toBe(403);
    expect((await call('GET', `/api/v1/reports/management-result?month=${month}`, { user: seller })).status).toBe(403);
  });
  it('parcelas dividem centavos sem perder nenhum e avançam competência/vencimento', async () => {
    const r = await call('POST', '/api/v1/expenses', { user: owner, body: { description: 'Reforma', category_id: cat, amount_cents: '100000', competence_month: month, due_date: '2031-03-10', installments: 3 } });
    expect(r.status).toBe(201);
    const rows = await admin`select amount_cents::text a, competence_month::text m, due_date::text d from finance.expenses where id = any(${r.body.data.ids}) order by due_date`;
    expect(rows.map((x) => x.a)).toEqual(['33334', '33333', '33333']);
    expect(rows.map((x) => x.m)).toEqual(['2031-03-01', '2031-04-01', '2031-05-01']);
    expect(rows[2].d).toBe('2031-05-10');
  });
  it('baixa parcial, excesso negado, estorno devolve saldo, cancelamento só sem baixa ativa', async () => {
    const id = (await call('POST', '/api/v1/expenses', { user: owner, body: { description: 'Aluguel março', category_id: cat, amount_cents: '300000', competence_month: month, due_date: '2031-03-05' } })).body.data.ids[0];
    const p1 = await call('POST', `/api/v1/expenses/${id}/payments`, { user: owner, body: { expected_version: 1, amount_cents: '100000', paid_on: '2031-03-05', method: 'PIX' } });
    expect(p1.status).toBe(201);
    expect((await call('POST', `/api/v1/expenses/${id}/payments`, { user: owner, body: { expected_version: 2, amount_cents: '200001', paid_on: '2031-03-06', method: 'PIX' } })).status).toBe(422);
    expect((await call('POST', `/api/v1/expenses/${id}/payments`, { user: owner, body: { expected_version: 1, amount_cents: '1', paid_on: '2031-03-06', method: 'PIX' } })).status).toBe(409);
    let e = (await call('GET', '/api/v1/expenses?from=2031-03-05&to=2031-03-06', { user: owner })).body.data.find((x: any) => x.id === id);
    expect(e).toMatchObject({ payment_state: 'PARTIAL', open_cents: '200000' });
    expect((await call('POST', `/api/v1/expenses/${id}/cancellations`, { user: owner, body: { expected_version: 2, reason: 'x' } })).status).toBe(409);
    expect((await call('POST', `/api/v1/expense-payments/${p1.body.data.payment_id}/reversals`, { user: owner, body: { reason: 'lançado errado' } })).status).toBe(200);
    e = (await call('GET', '/api/v1/expenses?from=2031-03-05&to=2031-03-06', { user: owner })).body.data.find((x: any) => x.id === id);
    expect(e).toMatchObject({ payment_state: 'OPEN', open_cents: '300000' });
    expect((await call('POST', `/api/v1/expenses/${id}/cancellations`, { user: owner, body: { expected_version: 3, reason: 'duplicada' } })).status).toBe(200);
  });
  it('resultado gerencial soma despesas por competência e separa tipos; sem venda não há receita', async () => {
    await call('POST', '/api/v1/expenses', { user: owner, body: { description: 'DAS', category_id: tax, amount_cents: '5000', competence_month: month, due_date: '2031-04-20' } });
    const r = (await call('GET', `/api/v1/reports/management-result?month=${month}`, { user: owner })).body.data;
    expect(r).toMatchObject({ revenue_cents: '0', taxes_cents: '5000', operating_expenses_cents: '33334' });
    expect(r.result_cents).toBe(String(-5000 - 33334));
    expect(r.warnings).toContain('payment_provider_fees_not_integrated');
  });
});
