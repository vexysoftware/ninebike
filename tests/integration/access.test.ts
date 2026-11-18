// SEG: negação padrão no servidor/banco, não só na interface.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, call, makeApp, makeUser, token, type TestUser } from '../support/harness';

let owner: TestUser, seller: TestUser, seller2: TestUser;
beforeAll(async () => {
  owner = await makeUser('OWNER');
  seller = await makeUser('SELLER');
  seller2 = await makeUser('SELLER');
});

describe('sessão e autenticação', () => {
  it('sem token, token expirado ou issuer errado → 401', async () => {
    expect((await call('GET', '/api/v1/session')).status).toBe(401);
    expect((await call('GET', '/api/v1/session', { token: await token(seller.id, true, { expired: true }) })).status).toBe(401);
    expect((await call('GET', '/api/v1/session', { token: await token(seller.id, true, { issuer: 'outro' }) })).status).toBe(401);
  });
  it('sessão retorna perfil e permissões atuais, sem secrets', async () => {
    const r = await call('GET', '/api/v1/session', { user: seller });
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(r.body.data).toMatchObject({ profile: 'SELLER', scope: 'ASSIGNED' });
    expect(r.body.data.permissions).not.toContain('users.manage');
    expect(r.body.data.permissions).not.toContain('inventory.cost.read');
  });
  it('usuário com JWT válido mas sem perfil (signup sem convite) é negado', async () => {
    const [u] = await admin`insert into auth.users (email) values ('sem-convite@teste.local') returning id`;
    expect((await call('GET', '/api/v1/session', { token: await token(u.id, true) })).status).toBe(401);
  });
  it('perfil desativado é negado imediatamente apesar do JWT ainda válido', async () => {
    const tmp = await makeUser('SELLER');
    expect((await call('GET', '/api/v1/session', { user: tmp })).status).toBe(200);
    await admin`update identity.profiles set active = false where id = ${tmp.id}`;
    expect((await call('GET', '/api/v1/session', { user: tmp })).status).toBe(401);
    expect((await call('POST', '/api/v1/contacts', { user: tmp, body: { name: 'X', mobile_phone: '11987654321' } })).status).toBe(401);
  });
});

describe('teto do perfil SELLER', () => {
  it('SELLER não administra usuários, convites, fornecedores, catálogo, estoque nem auditoria', async () => {
    expect((await call('GET', '/api/v1/admin/users', { user: seller })).status).toBe(403);
    expect((await call('PATCH', `/api/v1/admin/users/${seller.id}/access`, { user: seller, body: { expected_version: 1, profile: 'OWNER' } })).status).toBe(403);
    expect((await call('GET', '/api/v1/suppliers', { user: seller })).status).toBe(403);
    expect((await call('POST', '/api/v1/suppliers', { user: seller, body: { name: 'F', person_type: 'PJ' } })).status).toBe(403);
    expect((await call('POST', '/api/v1/catalog/products', { user: seller, body: { name: 'Bike', initial_quantity: 0 } })).status).toBe(403);
    expect((await call('POST', '/api/v1/pipeline-stages', { user: seller, body: { name: 'X', position: 0, kind: 'OPEN' } })).status).toBe(403);
    expect((await call('GET', `/api/v1/admin/audit-events?resource_type=profile&resource_id=${seller.id}`, { user: seller })).status).toBe(403);
  });
  it('autoelevação negada: SELLER tentando virar OWNER não muda papel', async () => {
    const [r] = await admin`select role from identity.user_roles where user_id = ${seller.id}`;
    expect(r.role).toBe('SELLER');
  });
  it('contato de outra carteira é invisível (404), não 403', async () => {
    const c = await call('POST', '/api/v1/contacts', { user: seller2, body: { name: 'Cliente da Bia', mobile_phone: '11991112222' } });
    expect(c.status).toBe(201);
    expect((await call('GET', `/api/v1/contacts/${c.body.data.id}`, { user: seller })).status).toBe(404);
    expect((await call('PATCH', `/api/v1/contacts/${c.body.data.id}`, { user: seller, body: { expected_version: 1, notes: 'x' } })).status).toBe(404);
    const list = await call('GET', '/api/v1/contacts?q=Cliente%20da%20Bia', { user: seller });
    expect(list.body.data).toHaveLength(0);
    expect((await call('GET', `/api/v1/contacts/${c.body.data.id}`, { user: owner })).status).toBe(200);
  });
});

describe('administração com MFA recente', () => {
  it('troca de perfil exige TOTP recente', async () => {
    const r = await call('PATCH', `/api/v1/admin/users/${seller2.id}/access`, { token: owner.tokenNoMfa, body: { expected_version: 1, active: true } });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('MFA_RECENCY_REQUIRED');
  });
  it('último OWNER ativo não pode ser desativado nem rebaixado', async () => {
    await admin`update identity.profiles set active = false where id in (select user_id from identity.user_roles where role = 'OWNER' and user_id <> ${owner.id})`;
    const [p] = await admin`select version from identity.profiles where id = ${owner.id}`;
    const r = await call('PATCH', `/api/v1/admin/users/${owner.id}/access`, { user: owner, body: { expected_version: p.version, profile: 'SELLER' } });
    expect(r.status).toBe(422);
    expect(r.body.details.reason).toBe('last_active_owner');
  });
  it('convite sem Auth Admin configurado → capacidade indisponível, sem sucesso fictício', async () => {
    const r = await call('POST', '/api/v1/admin/invitations', { user: owner, body: { email: 'nova@teste.local', name: 'Nova', profile: 'SELLER' } });
    expect(r.status).toBe(503);
    expect(r.body.code).toBe('CAPABILITY_UNAVAILABLE');
  });
  it('convite aceito cria perfil com o papel do convite; signup sem convite não', async () => {
    const invites: string[] = [];
    const app = makeApp({ authAdmin: { inviteUser: async (e) => void invites.push(e) } });
    const r = await call('POST', '/api/v1/admin/invitations', { user: owner, handler: app, body: { email: 'Vendedora.Nova@Teste.local', name: 'Vendedora Nova', profile: 'SELLER' } });
    expect(r.status).toBe(201);
    expect(invites).toEqual(['vendedora.nova@teste.local']);
    const [u] = await admin`insert into auth.users (email) values ('vendedora.nova@teste.local') returning id`;
    const [role] = await admin`select role from identity.user_roles where user_id = ${u.id}`;
    expect(role.role).toBe('SELLER');
  });
});

describe('rotas de desenvolvimento', () => {
  it('login de desenvolvimento não existe fora de ENVIRONMENT=local', async () => {
    const app = makeApp({ environment: 'production', devLogin: async () => ({ access_token: 'x' }) });
    const r = await call('POST', '/api/v1/dev/login', { handler: app, body: { email: 'a@b.co' }, key: null });
    expect(r.status).toBe(404);
  });
});

describe('contrato de comandos', () => {
  it('POST sem Idempotency-Key → 422; JSON com campo desconhecido → 422', async () => {
    expect((await call('POST', '/api/v1/contacts', { user: seller, key: null, body: { name: 'A', mobile_phone: '11987654321' } })).status).toBe(422);
    const r = await call('POST', '/api/v1/contacts', { user: seller, body: { name: 'A', mobile_phone: '11987654321', role: 'OWNER' } });
    expect(r.status).toBe(422);
    expect(r.body).toMatchObject({ code: 'VALIDATION_FAILED', details: { field: 'role', reason: 'unknown_field' } });
    expect(r.body.request_id).toBeTruthy();
  });
});

afterAll(async () => {});
