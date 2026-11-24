// Importação de contatos: normalização, duplicados pulados, inválidos relatados e sem atribuição à IA.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, call, makeUser, randomMobile, type TestUser } from '../support/harness';

let owner: TestUser, seller: TestUser;
beforeAll(async () => { owner = await makeUser('OWNER'); seller = await makeUser('SELLER'); await admin`update crm.settings set default_lead_owner_id = ${seller.id}`; });
afterAll(async () => { await admin`update crm.settings set default_lead_owner_id = null`; });

describe('importação de contatos', () => {
  it('importa, pula duplicado, relata inválido; vendedor não importa', async () => {
    const existing = randomMobile();
    await call('POST', '/api/v1/contacts', { user: seller, body: { name: 'Já existe', mobile_phone: existing } });
    const m1 = randomMobile(); const m2 = `+55119${8000 + Math.floor(Math.random() * 1999)}${String(Math.floor(Math.random() * 1e4)).padStart(4, '0')}`;
    const d1 = m1.replace(/\D/g, ''); // 11 dígitos sem máscara
    const e1 = `+55${d1}`;
    const old = `(${m2.slice(3, 5)}) ${m2.slice(6)}`; // sem o nono dígito
    const rows = [
      { line: 2, name: 'Maria Planilha', mobile_phone: d1, birthday: '15/03/1990', email: 'MARIA@X.COM' },
      { line: 3, name: 'João Antigo', mobile_phone: old, notes: 'comprou em 2023' },
      { line: 4, name: 'Duplicado', mobile_phone: existing },
      { line: 5, name: '', mobile_phone: randomMobile() },
      { line: 6, name: 'Fixo', mobile_phone: '1133334444' },
    ];
    const body = { batch_id: crypto.randomUUID(), file_name: 'clientes.csv', owner_id: seller.id, rows };
    expect((await call('POST', '/api/v1/imports/contacts', { user: seller, body })).status).toBe(403);
    const r = await call('POST', '/api/v1/imports/contacts', { user: owner, body });
    expect(r.status).toBe(200);
    expect(r.body.data.created).toBe(2);
    expect(r.body.data.skipped).toEqual([{ line: 4, reason: 'already_exists' }]);
    expect(r.body.data.invalid.map((x: any) => x.line).sort()).toEqual([5, 6]);
    const [maria] = await admin`select email, birthday_day, birthday_month, owner_id, imported_at from crm.contacts where mobile_e164 = ${e1}`;
    expect(maria).toMatchObject({ email: 'maria@x.com', birthday_day: 15, birthday_month: 3, owner_id: seller.id });
    expect(maria.imported_at).not.toBeNull();
    const [joao] = await admin`select 1 from crm.contacts where mobile_e164 = ${m2}`;
    expect(joao).toBeTruthy();
    const list = await call('GET', '/api/v1/imports/contacts', { user: owner });
    expect(list.body.data.find((b: any) => b.id === body.batch_id)).toMatchObject({ created: 2, skipped: 1, invalid: 2 });
  });

  it('cliente importado não vira "trazido pela IA" quando fala com a IA', async () => {
    const m = randomMobile(); const em = `+55${m.replace(/\D/g, '')}`;
    await call('POST', '/api/v1/imports/contacts', { user: owner, body: { batch_id: crypto.randomUUID(), rows: [{ line: 2, name: 'Cliente Antigo', mobile_phone: m }] } });
    const token = (await call('POST', '/api/v1/admin/agent-clients', { user: owner, body: { name: 'IA', scopes: ['visits.write'] } })).body.data.token;
    const v = await call('POST', '/agent/v1/visits', { token, key: null, body: { event_id: crypto.randomUUID(), mobile_phone: m, scheduled_at: new Date(Date.now() + 86400000).toISOString() } });
    expect(v.status).toBe(201);
    const rows = await admin`select 1 from integrations.ai_attributions a join crm.contacts c on c.id = a.contact_id where c.mobile_e164 = ${em}`;
    expect(rows).toHaveLength(0);
  });
});
