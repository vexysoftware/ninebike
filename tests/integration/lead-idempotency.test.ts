import { beforeAll, describe, expect, it } from 'vitest';
import { admin, call, makeUser, randomMobile } from '../support/harness';

describe('captura pública de lead', () => {
  beforeAll(async () => {
    const owner = await makeUser('OWNER');
    await admin`update crm.settings set default_lead_owner_id = ${owner.id}`;
  });
  it('três reenvios do mesmo submission_id criam um contato e uma oportunidade; resposta sem PII', async () => {
    const body = { submission_id: crypto.randomUUID(), name: 'Lead Landing', mobile_phone: randomMobile() };
    const rs = [];
    for (let i = 0; i < 3; i++) rs.push(await call('POST', '/public/v1/lead-submissions', { body, key: null }));
    expect(rs.map((r) => r.status)).toEqual([201, 200, 200]);
    expect(JSON.stringify(rs[0].body)).not.toContain(body.mobile_phone.replace(/\D/g, '').slice(-8));
    const [{ c, o }] = await admin`select count(distinct s.contact_id)::int c, count(distinct s.opportunity_id)::int o
      from crm.lead_submissions s where submission_id = ${body.submission_id}`;
    expect([c, o]).toEqual([1, 1]);
    const [opp] = await admin`select o.source from crm.opportunities o join crm.lead_submissions s on s.opportunity_id = o.id where s.submission_id = ${body.submission_id}`;
    expect(opp.source).toBe('landing');
  });
  it('mesmo submission_id com dados diferentes → 409', async () => {
    const id = crypto.randomUUID();
    await call('POST', '/public/v1/lead-submissions', { body: { submission_id: id, name: 'A', mobile_phone: randomMobile() }, key: null });
    const r = await call('POST', '/public/v1/lead-submissions', { body: { submission_id: id, name: 'B', mobile_phone: randomMobile() }, key: null });
    expect(r.status).toBe(409);
  });
  it('não aceita papel, dono ou IDs operacionais', async () => {
    const r = await call('POST', '/public/v1/lead-submissions', { body: { submission_id: crypto.randomUUID(), name: 'A', mobile_phone: randomMobile(), owner_id: crypto.randomUUID() }, key: null });
    expect(r.status).toBe(422);
  });
  it('sem responsável configurado → indisponível, sem gravar', async () => {
    await admin`update crm.settings set default_lead_owner_id = null`;
    const r = await call('POST', '/public/v1/lead-submissions', { body: { submission_id: crypto.randomUUID(), name: 'Sem dono', mobile_phone: randomMobile() }, key: null });
    expect(r.status).toBe(503);
    const [{ n }] = await admin`select count(*)::int n from crm.contacts where name = 'Sem dono'`;
    expect(n).toBe(0);
  });
});
