// Grants/RLS no PostgreSQL real: browser (anon/authenticated) não lê nem escreve; backend só executa api.*.
import { describe, expect, it } from 'vitest';
import { admin, apiSql } from '../support/harness';

async function asRole(role: string, q: string) {
  return admin.begin(async (tx) => {
    await tx.unsafe(`set local role ${role}`);
    return tx.unsafe(q);
  });
}

describe('papéis do browser sem acesso', () => {
  for (const role of ['anon', 'authenticated']) {
    it(`${role} não lê/escreve tabelas internas nem executa RPCs`, async () => {
      await expect(asRole(role, 'select * from crm.contacts')).rejects.toThrow(/permission denied/);
      await expect(asRole(role, "insert into crm.contacts (name) values ('x')")).rejects.toThrow(/permission denied/);
      await expect(asRole(role, 'select * from inventory.quantity_balances')).rejects.toThrow(/permission denied/);
      await expect(asRole(role, `select api.contact_create('{}'::jsonb, '{}'::jsonb)`)).rejects.toThrow(/permission denied/);
      await expect(asRole(role, `select api.lead_submit('{}'::jsonb)`)).rejects.toThrow(/permission denied/);
    });
  }
});

describe('papel do backend ninebike_api', () => {
  it('não acessa tabelas diretamente', async () => {
    await expect(apiSql`select * from crm.contacts`).rejects.toThrow(/permission denied/);
    await expect(apiSql`update identity.user_roles set role = 'OWNER'`).rejects.toThrow(/permission denied/);
    await expect(apiSql`select * from audit.audit_events`).rejects.toThrow(/permission denied/);
  });
  it('não executa funções internas (helpers de identidade/escopo)', async () => {
    await expect(apiSql`select identity.require_actor(gen_random_uuid(), null)`).rejects.toThrow(/permission denied/);
    await expect(apiSql`select api.fail('X', '{}')`).rejects.toThrow(/permission denied/);
  });
  it('RLS habilitada em todas as tabelas internas', async () => {
    const rows = await admin`select schemaname, tablename from pg_tables
      where schemaname in ('identity','audit','integrations','crm','inventory') and not rowsecurity`;
    expect(rows).toEqual([]);
  });
});

describe('append-only', () => {
  it('auditoria e movimentos de estoque não aceitam UPDATE/DELETE nem pelo dono', async () => {
    await admin`insert into audit.audit_events (actor_kind, action, resource_type, decision) values ('SYSTEM', 't', 't', 'ALLOW')`;
    await expect(admin`update audit.audit_events set action = 'x'`).rejects.toThrow(/append-only/);
    await expect(admin`delete from audit.audit_events`).rejects.toThrow(/append-only/);
    const triggers = await admin`select tgrelid::regclass::text t from pg_trigger where tgname like '%append_only%' order by 1`;
    expect(triggers.map((r) => r.t)).toEqual(['audit.audit_events', 'inventory.inventory_movements']);
  });
});
