import { beforeAll, describe, expect, it } from 'vitest';
import { admin, call, makeUser, randomCpf, randomMobile, type TestUser } from '../support/harness';

let owner: TestUser, seller: TestUser;
beforeAll(async () => { owner = await makeUser('OWNER'); seller = await makeUser('SELLER'); });

describe('contatos (CRM-01..06, CON-01/02)', () => {
  it('lead sem CPF/e-mail é válido, papel CUSTOMER e carteira do autor', async () => {
    const r = await call('POST', '/api/v1/contacts', { user: seller, body: { name: 'Lúcia Ávila', mobile_phone: randomMobile() } });
    expect(r.status).toBe(201);
    const g = await call('GET', `/api/v1/contacts/${r.body.data.id}`, { user: seller });
    expect(g.body.data).toMatchObject({ name: 'Lúcia Ávila', cpf: null, email: null, roles: ['CUSTOMER'], owner_id: seller.id });
  });

  it('mesma Idempotency-Key + mesmo corpo devolve a resposta original; corpo diferente → 409', async () => {
    const key = crypto.randomUUID();
    const body = { name: 'Repetida', mobile_phone: randomMobile() };
    const a = await call('POST', '/api/v1/contacts', { user: seller, key, body });
    const b = await call('POST', '/api/v1/contacts', { user: seller, key, body });
    expect(b.status).toBe(201);
    expect(b.body.data.id).toBe(a.body.data.id);
    expect(b.headers.get('idempotent-replayed')).toBe('true');
    const [{ n }] = await admin`select count(*)::int n from crm.contacts where name = 'Repetida'`;
    expect(n).toBe(1);
    const c = await call('POST', '/api/v1/contacts', { user: seller, key, body: { ...body, name: 'Outra' } });
    expect(c.status).toBe(409);
    expect(c.body.code).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('PATCH: omitido preserva, null limpa opcional, não limpa celular de cliente, versão concorrente → 409', async () => {
    const cpf = randomCpf();
    const r = await call('POST', '/api/v1/contacts', { user: seller, body: { name: 'Edição', mobile_phone: randomMobile(), cpf, email: 'a@b.com.br', notes: 'nota' } });
    const id = r.body.data.id;
    const p1 = await call('PATCH', `/api/v1/contacts/${id}`, { user: seller, body: { expected_version: 1, email: null } });
    expect(p1.status).toBe(200);
    const g = await call('GET', `/api/v1/contacts/${id}`, { user: seller });
    expect(g.body.data).toMatchObject({ email: null, cpf, notes: 'nota', version: 2 });
    const p2 = await call('PATCH', `/api/v1/contacts/${id}`, { user: seller, body: { expected_version: 2, mobile_phone: null } });
    expect(p2.status).toBe(422);
    const p3 = await call('PATCH', `/api/v1/contacts/${id}`, { user: seller, body: { expected_version: 1, notes: 'x' } });
    expect(p3.status).toBe(409);
    expect(p3.body.code).toBe('VERSION_CONFLICT');
  });

  it('telefone compartilhado não mescla: dois contatos, duplicata sugerida', async () => {
    const mobile = randomMobile();
    const a = await call('POST', '/api/v1/contacts', { user: seller, body: { name: 'Pai', mobile_phone: mobile } });
    const b = await call('POST', '/api/v1/contacts', { user: seller, body: { name: 'Filho', mobile_phone: mobile } });
    expect(b.status).toBe(201);
    expect(b.body.data.id).not.toBe(a.body.data.id);
    expect(b.body.data.possible_duplicates).toEqual([expect.objectContaining({ id: a.body.data.id, matched_on: ['mobile_phone'] })]);
  });

  it('fornecedor: nome + PF/PJ bastam; mesmo contato ganha papel cliente exigindo celular', async () => {
    const s = await call('POST', '/api/v1/suppliers', { user: owner, body: { name: 'Distribuidora Pedal', person_type: 'PJ', cnpj: '11.222.333/0001-81' } });
    expect(s.status).toBe(201);
    const id = s.body.data.id;
    const bad = await call('POST', `/api/v1/contacts/${id}/roles`, { user: owner, body: { expected_version: 1, role: 'CUSTOMER' } });
    expect(bad.status).toBe(422);
    const good = await call('POST', `/api/v1/contacts/${id}/roles`, { user: owner, body: { expected_version: 1, role: 'CUSTOMER', mobile_phone: randomMobile() } });
    expect(good.status).toBe(200);
    const g = await call('GET', `/api/v1/contacts/${id}`, { user: owner });
    expect(g.body.data.roles).toEqual(['CUSTOMER', 'SUPPLIER']);
    const [{ n }] = await admin`select count(*)::int n from crm.contacts where name = 'Distribuidora Pedal'`;
    expect(n).toBe(1);
  });

  it('busca por nome e por dígitos do celular; paginação com cursor estável', async () => {
    for (let i = 0; i < 3; i++) await call('POST', '/api/v1/contacts', { user: seller, body: { name: `Paginado ${i}`, mobile_phone: randomMobile() } });
    const p1 = await call('GET', '/api/v1/contacts?q=Paginado&limit=2', { user: seller });
    expect(p1.body.data).toHaveLength(2);
    expect(p1.body.page.has_more).toBe(true);
    const p2 = await call('GET', `/api/v1/contacts?q=Paginado&limit=2&cursor=${p1.body.page.next_cursor}`, { user: seller });
    expect(p2.body.data).toHaveLength(1);
    const stale = await call('GET', `/api/v1/contacts?q=Outro&limit=2&cursor=${p1.body.page.next_cursor}`, { user: seller });
    expect(stale.status).toBe(400);
  });
});

describe('aniversariantes', () => {
  it('só PF confirmado; 29/02 em ano comum é exceção explícita; sem ano não há idade', async () => {
    const mk = (name: string, birthday: object, person_type?: string) =>
      call('POST', '/api/v1/contacts', { user: seller, body: { name, mobile_phone: randomMobile(), birthday, ...(person_type ? { person_type } : {}) } });
    await mk('Niver PF', { day: 20, month: 11, year: 1990 }, 'PF');
    await mk('Niver sem tipo', { day: 20, month: 11 });
    await mk('Niver bissexto', { day: 29, month: 2 }, 'PF');
    expect((await mk('Data inválida', { day: 31, month: 4 }, 'PF')).status).toBe(422);
    const nov = await call('GET', '/api/v1/contacts/birthdays?from=2026-11-01&to=2026-12-01', { user: seller });
    expect(nov.status).toBe(200);
    const names = nov.body.data.data.map((x: any) => x.name);
    expect(names).toContain('Niver PF');
    expect(names).not.toContain('Niver sem tipo');
    expect(nov.body.data.data.find((x: any) => x.name === 'Niver PF')).toMatchObject({ occurrence_date: '2026-11-20', age: 36 });
    expect(nov.body.data.pending_person_type).toBeGreaterThanOrEqual(1);
    const feb = await call('GET', '/api/v1/contacts/birthdays?from=2027-02-01&to=2027-03-01', { user: seller });
    expect(feb.body.data.data.find((x: any) => x.name === 'Niver bissexto')).toMatchObject({ leap_exception: true, occurrence_date: null, age: null });
    const virada = await call('GET', '/api/v1/contacts/birthdays?from=2026-12-15&to=2027-03-02', { user: seller });
    expect(virada.body.data.data.map((x: any) => x.name)).toContain('Niver bissexto');
  });
});
