// T11 (FIS): rascunho → validação → revisão → aprovação humana sobre o hash; mudança invalida; envio bloqueado.
import { beforeAll, describe, expect, it } from 'vitest';
import { admin, call, makeUser, randomCpf, randomMobile, token, type TestUser } from '../support/harness';

let owner: TestUser, seller: TestUser;
const today = new Date().toISOString().slice(0, 10);

async function order(u: TestUser) {
  const c = (await call('POST', '/api/v1/contacts', { user: u, body: { name: 'Cliente Fiscal', mobile_phone: randomMobile(), person_type: 'PF' } })).body.data.id;
  const p = (await call('POST', '/api/v1/catalog/products', { user: owner, body: { name: `Bike F ${Math.random()}`, initial_quantity: 1, sale_price_cents: '800000' } })).body.data.id;
  const q = (await call('POST', '/api/v1/quotes', { user: u, body: { contact_id: c, items: [{ product_id: p, quantity: 1 }] } })).body.data.id;
  await call('POST', '/api/v1/reservations', { user: u, body: { quote_id: q, quote_version: 1 } });
  return { order: (await call('POST', '/api/v1/orders', { user: u, body: { quote_id: q, quote_version: 1, allocations: [{ mode: 'PIX', principal_cents: '800000', due_date: today }] } })).body.data.id as string, product: p };
}

beforeAll(async () => {
  owner = await makeUser('OWNER'); seller = await makeUser('SELLER');
  const [{ n }] = await admin`select count(*)::int n from identity.commercial_policies`;
  if (n === 0) await call('POST', '/api/v1/admin/policy-versions', { user: owner, body: { expected_revision: 0, reservation_minutes: 120, quote_validity_minutes: 2880, seller_max_discount_bps: 500 } });
  const [s] = await admin`select version from fiscal.settings`;
  await call('PATCH', '/api/v1/admin/fiscal-configurations', { user: owner, body: { expected_version: s.version, issuer: { legal_name: 'Ninebike Teste Ltda', cnpj: '11.222.333/0001-81', state: 'sp', tax_regime: 'SIMPLES_NACIONAL' } } });
});

describe('preparo fiscal com aprovação humana', () => {
  it('fluxo completo; nada é transmitido', async () => {
    const { order: o } = await order(seller);
    const d = await call('POST', '/api/v1/fiscal-documents', { user: seller, body: { order_id: o } });
    expect(d.status).toBe(201);
    const id = d.body.data.id;
    expect((await call('POST', '/api/v1/fiscal-documents', { user: seller, body: { order_id: o } })).status).toBe(409);
    let doc = (await call('GET', `/api/v1/fiscal-documents/${id}`, { user: seller })).body.data;
    expect(doc.snapshot.total_cents).toBe('800000');
    let v = await call('POST', `/api/v1/fiscal-documents/${id}/validations`, { user: seller, body: { expected_version: doc.version } });
    expect(v.body.data.validation.ok).toBe(false);
    expect(v.body.data.validation.issues.map((i: any) => i.field)).toEqual(expect.arrayContaining(['recipient.cpf', 'recipient.address', 'items[0].ncm', 'items[0].cfop']));
    doc = (await call('GET', `/api/v1/fiscal-documents/${id}`, { user: seller })).body.data;
    const patch = await call('PATCH', `/api/v1/fiscal-documents/${id}/draft`, { user: seller, body: { expected_version: doc.version,
      recipient: { cpf: randomCpf(), address: { street: 'Rua A', number: '10', district: 'Centro', city: 'São Paulo', state: 'sp', postal_code: '01001-000' } },
      items: [{ position: 0, ncm: '8712.00.10', cfop: '5102' }] } });
    expect(patch.status).toBe(200);
    v = await call('POST', `/api/v1/fiscal-documents/${id}/validations`, { user: seller, body: { expected_version: patch.body.data.version } });
    expect(v.body.data.validation).toMatchObject({ ok: true });
    doc = (await call('GET', `/api/v1/fiscal-documents/${id}`, { user: owner })).body.data;
    expect(doc.review_state).toBe('READY_FOR_REVIEW');

    // vendedora não aprova; dono sem MFA recente não aprova; hash diferente não aprova
    expect((await call('POST', `/api/v1/fiscal-documents/${id}/approvals`, { user: seller, body: { expected_version: doc.version, snapshot_hash: doc.snapshot_hash } })).status).toBe(403);
    expect((await call('POST', `/api/v1/fiscal-documents/${id}/approvals`, { token: owner.tokenNoMfa, body: { expected_version: doc.version, snapshot_hash: doc.snapshot_hash } })).body.code).toBe('MFA_RECENCY_REQUIRED');
    expect((await call('POST', `/api/v1/fiscal-documents/${id}/approvals`, { user: owner, body: { expected_version: doc.version, snapshot_hash: 'a'.repeat(64) } })).status).toBe(409);
    const ap = await call('POST', `/api/v1/fiscal-documents/${id}/approvals`, { user: owner, body: { expected_version: doc.version, snapshot_hash: doc.snapshot_hash } });
    expect(ap.status).toBe(200);
    const [ord] = await admin`select fiscal_state from sales.orders where id = ${o}`;
    expect(ord.fiscal_state).toBe('APPROVED_INTERNALLY');

    // envio: indisponível (sem provedor homologado)
    expect((await call('POST', `/api/v1/fiscal-documents/${id}/submit`, { user: owner, body: {} })).status).toBe(503);
    doc = (await call('GET', `/api/v1/fiscal-documents/${id}`, { user: owner })).body.data;
    expect(doc.official_status).toBe('NOT_SENT');

    // mudança depois da aprovação invalida a aprovação
    await call('PATCH', `/api/v1/fiscal-documents/${id}/draft`, { user: owner, body: { expected_version: doc.version, additional_info: 'Garantia 1 ano' } });
    doc = (await call('GET', `/api/v1/fiscal-documents/${id}`, { user: owner })).body.data;
    expect(doc).toMatchObject({ review_state: 'DRAFT', approval_current: false });
  });

  it('evidência da nota autorizada no emissor atual; chave repetida negada', async () => {
    const a = await order(owner); const b = await order(owner);
    const da = (await call('POST', '/api/v1/fiscal-documents', { user: owner, body: { order_id: a.order } })).body.data.id;
    const db = (await call('POST', '/api/v1/fiscal-documents', { user: owner, body: { order_id: b.order } })).body.data.id;
    const key = '3526' + String(Date.now()).padStart(40, '0').slice(-40);
    expect((await call('POST', `/api/v1/fiscal-documents/${da}/external-evidence`, { user: owner, body: { expected_version: 1, access_key: key, number: '123', series: '1' } })).status).toBe(200);
    expect((await call('POST', `/api/v1/fiscal-documents/${db}/external-evidence`, { user: owner, body: { expected_version: 1, access_key: key } })).status).toBe(422);
    expect((await call('POST', `/api/v1/fiscal-documents/${da}/external-evidence`, { user: seller, body: { expected_version: 2, access_key: key } })).status).toBe(403);
    const [ord] = await admin`select fiscal_state from sales.orders where id = ${a.order}`;
    expect(ord.fiscal_state).toBe('AUTHORIZED_EXTERNAL');
  });

  it('vendedora não prepara nota de venda alheia', async () => {
    const { order: o } = await order(owner);
    expect((await call('POST', '/api/v1/fiscal-documents', { user: seller, body: { order_id: o } })).status).toBe(404);
  });
});
