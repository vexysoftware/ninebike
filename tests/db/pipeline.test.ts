// Pipeline com PostgreSQL real e sessões independentes: ordem persistida, conflitos sem sobrescrita.
import { beforeAll, describe, expect, it } from 'vitest';
import { admin, call, makeUser, randomMobile, type TestUser } from '../support/harness';

let owner: TestUser, seller: TestUser;
type Stage = { id: string; name: string; kind: string; position: number; version: number; cards_version: number; cards: Array<{ id: string; version: number; position: number }> };
const board = async (u: TestUser): Promise<Stage[]> => (await call('GET', '/api/v1/pipeline-stages?limit=100', { user: u })).body.data;
const stage = async (u: TestUser, name: string) => (await board(u)).find((s) => s.name === name)!;

async function newOpp(u: TestUser, title: string) {
  const c = await call('POST', '/api/v1/contacts', { user: u, body: { name: title, mobile_phone: randomMobile() } });
  const o = await call('POST', '/api/v1/opportunities', { user: u, body: { contact_id: c.body.data.id, title } });
  expect(o.status).toBe(201);
  return o.body.data.id as string;
}
async function move(u: TestUser, oppId: string, target: Stage, src: Stage, extra: object = {}) {
  const opp = src.cards.find((c) => c.id === oppId)!;
  return call('POST', `/api/v1/opportunities/${oppId}/moves`, { user: u, body: {
    expected_version: opp.version, stage_id: target.id, expected_stage_version: target.version,
    expected_source_cards_version: src.cards_version, expected_target_cards_version: target.cards_version, ...extra } });
}
async function assertContiguous() {
  const bad = await admin`select stage_id from crm.opportunities group by stage_id
    having min(position) <> 0 or max(position) <> count(*) - 1 or count(distinct position) <> count(*)`;
  expect(bad).toEqual([]);
}

beforeAll(async () => { owner = await makeUser('OWNER'); seller = await makeUser('SELLER'); });

describe('mover cartões', () => {
  it('ordem dentro da etapa persiste após recarregar (âncora antes/depois)', async () => {
    const a = await newOpp(seller, 'Ordem A'); const b = await newOpp(seller, 'Ordem B'); const c = await newOpp(seller, 'Ordem C');
    let novo = await stage(seller, 'Novo');
    const r = await move(seller, c, novo, novo, { before_opportunity_id: a });
    expect(r.status).toBe(200);
    novo = await stage(seller, 'Novo');
    const ids = novo.cards.map((x) => x.id).filter((id) => [a, b, c].includes(id));
    expect(ids).toEqual([c, a, b]);
    await assertContiguous();
  });

  it('dois movimentos concorrentes do mesmo cartão com as mesmas versões: um grava, outro 409', async () => {
    const id = await newOpp(seller, 'Disputa');
    const novo = await stage(seller, 'Novo');
    const contato = await stage(seller, 'Contato');
    const qualif = await stage(seller, 'Qualificação');
    const [r1, r2] = await Promise.all([move(seller, id, contato, novo), move(seller, id, qualif, novo)]);
    expect([r1.status, r2.status].sort()).toEqual([200, 409]);
    const [row] = await admin`select stage_id from crm.opportunities where id = ${id}`;
    expect(row.stage_id).toBe(r1.status === 200 ? contato.id : qualif.id);
    await assertContiguous();
  });

  it('cartões diferentes para a mesma etapa com cards_version antiga: o segundo reconsulta (409)', async () => {
    const x = await newOpp(seller, 'Paralelo X'); const y = await newOpp(seller, 'Paralelo Y');
    const novo = await stage(seller, 'Novo'); const prop = await stage(seller, 'Proposta');
    const [r1, r2] = await Promise.all([move(seller, x, prop, novo), move(seller, y, prop, novo)]);
    expect([r1.status, r2.status].sort()).toEqual([200, 409]);
    await assertContiguous();
  });

  it('Perdido exige motivo; mover não cria nenhum efeito financeiro/estoque', async () => {
    const id = await newOpp(seller, 'Perda');
    const [{ n: before }] = await admin`select count(*)::int n from inventory.inventory_movements`;
    const novo = await stage(seller, 'Novo'); const perdido = await stage(seller, 'Perdido');
    expect((await move(seller, id, perdido, novo)).status).toBe(422);
    const ok = await move(seller, id, perdido, novo, { loss_reason: 'Comprou em outra loja' });
    expect(ok.status).toBe(200);
    const g = await call('GET', `/api/v1/opportunities/${id}`, { user: seller });
    expect(g.body.data.lost_reason).toBe('Comprou em outra loja');
    expect(g.body.data.history.map((h: any) => h.action)).toContain('opportunity.moved');
    const [{ n }] = await admin`select count(*)::int n from inventory.inventory_movements`;
    expect(n).toBe(before);
  });

  it('SELLER não move cartão de outra carteira (404)', async () => {
    const other = await makeUser('SELLER');
    const id = await newOpp(other, 'Alheio');
    const novo = await stage(other, 'Novo'); const contato = await stage(other, 'Contato');
    expect((await move(seller, id, contato, novo)).status).toBe(404);
  });
});

describe('colunas (OWNER)', () => {
  it('reordenar colunas exige a lista completa com versões atuais; persiste', async () => {
    const b = await board(owner);
    const reversed = [...b].reverse().map((s) => ({ id: s.id, expected_version: s.version }));
    const r = await call('POST', '/api/v1/pipeline-stages/reorder', { user: owner, body: { stages: reversed } });
    expect(r.status).toBe(200);
    expect((await board(owner)).map((s) => s.id)).toEqual(reversed.map((s) => s.id));
    const stale = await call('POST', '/api/v1/pipeline-stages/reorder', { user: owner, body: { stages: reversed } });
    expect(stale.status).toBe(409);
    const cur = await board(owner);
    await call('POST', '/api/v1/pipeline-stages/reorder', { user: owner, body: { stages: [...cur].reverse().map((s) => ({ id: s.id, expected_version: s.version })) } });
  });
  it('arquivar etapa ocupada é negado; criar/renomear/arquivar vazia funciona', async () => {
    const novo = await stage(owner, 'Novo');
    expect((await call('POST', `/api/v1/pipeline-stages/${novo.id}/archive`, { user: owner, body: { expected_version: novo.version } })).status).toBe(422);
    const c = await call('POST', '/api/v1/pipeline-stages', { user: owner, body: { name: 'Test-drive', position: 2, kind: 'OPEN' } });
    expect(c.status).toBe(201);
    let td = await stage(owner, 'Test-drive');
    expect((await board(owner)).findIndex((s) => s.id === td.id)).toBe(2);
    expect((await call('PATCH', `/api/v1/pipeline-stages/${td.id}`, { user: owner, body: { expected_version: td.version, name: 'Test ride' } })).status).toBe(200);
    td = await stage(owner, 'Test ride');
    expect((await call('POST', `/api/v1/pipeline-stages/${td.id}/archive`, { user: owner, body: { expected_version: td.version } })).status).toBe(200);
    const positions = (await board(owner)).map((s) => s.position);
    expect(positions).toEqual(positions.map((_, i) => i));
  });
});
