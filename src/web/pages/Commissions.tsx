// Comissão da equipe (T16) e chaves da IA do WhatsApp (n8n).
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, describeError } from '../api';
import { PageHead, useCommand } from '../components/Shell';
import { Empty, ErrorBox, Field, Loading, Status, formatCents, formatInstant, useLoad } from '../components/ui';
import { useSession } from '../session';

type Entry = { id: string; order_id: string; order_number: number; confirmed_at: string; customer_name: string; seller_id: string;
  seller_name: string; base_cents: string; bps: number; amount_cents: string; state: 'ACCRUED' | 'PAID' | 'REVERSED'; paid_at: string | null; paid_note: string | null };
type Summary = { seller_id: string; seller_name: string; orders: number; sales_cents: string; accrued_cents: string; paid_cents: string; reversed_cents: string };
type Rule = { configured: false } | { configured: true; version: number; default_bps: number; overrides: Record<string, number>; my_bps: number; effective_from: string; note: string | null };

const pct = (bps: number) => `${(bps / 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
const STATE = { ACCRUED: ['warn', 'A pagar'], PAID: ['ok', 'Paga'], REVERSED: ['neutral', 'Estornada'] } as const;

function monthRange(offset = 0) {
  const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + offset);
  const iso = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-01`;
  const next = new Date(d); next.setMonth(next.getMonth() + 1);
  return { from: iso(d), to: iso(next) };
}

export function CommissionsPage() {
  const { session } = useSession();
  const isOwner = session?.profile === 'OWNER';
  const [range, setRange] = useState(monthRange());
  const [seller, setSeller] = useState('');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const cmd = useCommand();
  const rule = useLoad(() => api.get<Rule>('/api/v1/staff-commissions/rule'), []);
  const st = useLoad(() => api.get<{ rule_configured: boolean; entries: Entry[]; by_seller: Summary[] }>(
    `/api/v1/staff-commissions?from=${range.from}&to=${range.to}${seller ? `&seller_id=${seller}` : ''}`), [range.from, range.to, seller]);

  async function pay() {
    const note = window.prompt('Observação do pagamento (ex.: Pix em 05/12)') ?? undefined;
    if (await cmd.run('POST', '/api/v1/staff-commissions/payments', { entry_ids: [...sel], ...(note ? { note } : {}) }, { success: 'Comissões marcadas como pagas.' })) {
      setSel(new Set()); st.reload();
    }
  }

  return (
    <>
      <PageHead title="Comissões" subtitle={isOwner ? '' : ''} />
      {rule.data && !rule.data.configured && (
        <div className="alert" role="status" style={{ marginBottom: 16 }}>
          Nenhuma regra de comissão configurada. Pedidos confirmados sem regra não geram comissão (nenhum valor é presumido).
          {isOwner && ' Defina a regra abaixo.'}
        </div>)}
      {rule.data?.configured && !isOwner && <p className="muted" style={{ marginBottom: 16 }}>Seu percentual atual: <strong>{pct(rule.data.my_bps)}</strong> sobre o valor do pedido sem frete.</p>}

      <div className="toolbar" style={{ marginBottom: 16 }}>
        <Field label="De">{(p) => <input {...p} type="date" className="input" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />}</Field>
        <Field label="Até (exclusivo)">{(p) => <input {...p} type="date" className="input" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />}</Field>
        <button className="btn btn-sm" style={{ alignSelf: 'end' }} onClick={() => setRange(monthRange(0))}>Este mês</button>
        <button className="btn btn-sm" style={{ alignSelf: 'end' }} onClick={() => setRange(monthRange(-1))}>Mês passado</button>
        {isOwner && st.data && (
          <Field label="Vendedor">{(p) => (
            <select {...p} className="input" value={seller} onChange={(e) => setSeller(e.target.value)}>
              <option value="">Todos</option>
              {st.data!.by_seller.map((s) => <option key={s.seller_id} value={s.seller_id}>{s.seller_name}</option>)}
            </select>)}</Field>)}
      </div>

      {st.loading ? <Loading /> : st.error ? <ErrorBox error={st.error} onRetry={st.reload} /> : (
        <>
          <section className="card">
            <div className="card-head"><h2>Resumo por vendedor</h2></div>
            {st.data!.by_seller.length === 0 ? <Empty title="Sem comissões no período" /> : (
              <div className="table-wrap" style={{ border: 0 }}><table className="table">
                <thead><tr><th>Vendedor</th><th className="num">Pedidos</th><th className="num">Vendas (sem frete)</th><th className="num">A pagar</th><th className="num">Pago</th><th className="num">Estornado</th></tr></thead>
                <tbody>{st.data!.by_seller.map((s) => (
                  <tr key={s.seller_id}><td>{s.seller_name}</td><td className="num">{s.orders}</td><td className="num">{formatCents(s.sales_cents)}</td>
                    <td className="num"><strong>{formatCents(s.accrued_cents)}</strong></td><td className="num">{formatCents(s.paid_cents)}</td><td className="num">{formatCents(s.reversed_cents)}</td></tr>))}
                </tbody></table></div>)}
          </section>
          <section className="card">
            <div className="card-head"><h2>Lançamentos</h2>
              {isOwner && <button className="btn btn-primary btn-sm" disabled={sel.size === 0 || cmd.busy} onClick={() => void pay()}>Marcar {sel.size || ''} como paga(s)</button>}</div>
            {st.data!.entries.length === 0 ? <Empty title="Nenhum pedido com comissão no período" /> : (
              <div className="table-wrap" style={{ border: 0 }}><table className="table">
                <thead><tr>{isOwner && <th />}<th>Pedido</th><th>Data</th><th>Cliente</th>{isOwner && <th>Vendedor</th>}<th className="num">Base</th><th className="num">%</th><th className="num">Comissão</th><th>Situação</th></tr></thead>
                <tbody>{st.data!.entries.map((e) => (
                  <tr key={e.id}>
                    {isOwner && <td>{e.state === 'ACCRUED' && <input type="checkbox" aria-label={`Selecionar pedido ${e.order_number}`} checked={sel.has(e.id)}
                      onChange={(x) => { const n = new Set(sel); if (x.target.checked) n.add(e.id); else n.delete(e.id); setSel(n); }} />}</td>}
                    <td><Link to={`/app/vendas/${e.order_id}`}>#{e.order_number}</Link></td><td>{formatInstant(e.confirmed_at)}</td><td>{e.customer_name}</td>
                    {isOwner && <td>{e.seller_name}</td>}
                    <td className="num">{formatCents(e.base_cents)}</td><td className="num">{pct(e.bps)}</td><td className="num"><strong>{formatCents(e.amount_cents)}</strong></td>
                    <td><Status tone={STATE[e.state][0]}>{STATE[e.state][1]}</Status>{e.paid_note && <div className="subtle">{e.paid_note}</div>}</td>
                  </tr>))}
                </tbody></table></div>)}
          </section>
        </>)}
      {isOwner && <RuleCard rule={rule.data} onDone={() => { rule.reload(); st.reload(); }} />}
      {cmd.error != null && <div className="alert alert-danger" role="alert">{describeError(cmd.error)}</div>}
    </>
  );
}

function RuleCard({ rule, onDone }: { rule: Rule | null; onDone: () => void }) {
  const users = useLoad(() => api.get<{ users: Array<{ id: string; name: string; active: boolean }> }>('/api/v1/admin/users'), []);
  const [def, setDef] = useState('');
  const [ov, setOv] = useState<Record<string, string>>({});
  const cmd = useCommand();
  const cur = rule?.configured ? rule : null;
  const toBps = (s: string) => Math.round(Number(s.replace(',', '.')) * 100);
  return (
    <section className="card">
      <div className="card-head"><h2>Regra de comissão</h2>{cur ? <Status tone="ok">Versão {cur.version}</Status> : <Status tone="warn">Não configurada</Status>}</div>
      <form className="form-grid" onSubmit={async (e) => {
        e.preventDefault();
        const overrides = Object.entries(ov).filter(([, v]) => v.trim() !== '').map(([profile_id, v]) => ({ profile_id, bps: toBps(v) }));
        if (await cmd.run('POST', '/api/v1/admin/staff-commission-rules', { expected_version: cur?.version ?? 0, default_bps: toBps(def), overrides }, { success: 'Regra de comissão salva.' })) {
          setDef(''); setOv({}); onDone();
        }
      }}>
        <Field label="Percentual padrão (%)">{(p) => <input {...p} className="input" inputMode="decimal" required value={def} onChange={(e) => setDef(e.target.value)} placeholder={cur ? String(cur.default_bps / 100) : '2'} />}</Field>
        {users.data?.users.filter((u) => u.active).map((u) => (
          <Field key={u.id} label={`${u.name} (%)`} optional help="Vazio = usa o padrão">{(p) => <input {...p} className="input" inputMode="decimal" value={ov[u.id] ?? ''}
            placeholder={cur?.overrides[u.id] != null ? String(cur.overrides[u.id] / 100) : ''} onChange={(e) => setOv({ ...ov, [u.id]: e.target.value })} />}</Field>))}
        <div className="form-actions" style={{ alignSelf: 'end' }}><button className="btn btn-primary" disabled={cmd.busy}>Salvar nova versão</button></div>
      </form>
    </section>
  );
}

type AgentClient = { id: string; name: string; token_prefix: string; scopes: string[]; created_at: string; created_by_name: string; revoked_at: string | null; last_used_at: string | null; requests_24h: number };
const SCOPES = [['catalog.read', 'Consultar produtos, preço e estoque'], ['customers.read', 'Reconhecer cliente pelo celular'], ['leads.write', 'Registrar lead e anotações no CRM']] as const;

export function AgentKeysCard() {
  const list = useLoad(() => api.get<AgentClient[]>('/api/v1/admin/agent-clients'), []);
  const [name, setName] = useState('IA WhatsApp (n8n)');
  const [scopes, setScopes] = useState<string[]>(SCOPES.map((s) => s[0]));
  const [token, setToken] = useState<string | null>(null);
  const cmd = useCommand();
  return (
    <section className="card">
      <div className="card-head"><h2>Integração com a IA do WhatsApp</h2></div>
      <p className="subtle" style={{ marginBottom: 12 }}>Catálogo, cliente e leads. Sem custo, financeiro ou fiscal.</p>
      {token && (
        <div className="alert" role="status" style={{ marginBottom: 12 }}>
          <strong>Copie agora — a chave não será mostrada de novo.</strong>
          <div className="unit-row" style={{ marginTop: 8 }}><code style={{ wordBreak: 'break-all', flex: 1 }}>{token}</code>
            <button className="btn btn-sm" onClick={() => void navigator.clipboard?.writeText(token)}>Copiar</button>
            <button className="btn btn-sm" onClick={() => setToken(null)}>Já copiei</button></div>
          <div className="subtle" style={{ marginTop: 8 }}>No n8n: cabeçalho <code>Authorization: Bearer {'<chave>'}</code>, URL base <code>{window.location.origin}/agent/v1</code></div>
        </div>)}
      <form className="form-grid" onSubmit={async (e) => {
        e.preventDefault();
        const r = await cmd.run<{ token: string }>('POST', '/api/v1/admin/agent-clients', { name, scopes }, { success: 'Chave criada.' });
        if (r?.token) { setToken(r.token); list.reload(); }
      }}>
        <Field label="Nome da integração">{(p) => <input {...p} className="input" value={name} onChange={(e) => setName(e.target.value)} required />}</Field>
        <fieldset style={{ border: 0, padding: 0 }}><legend className="subtle">Permissões</legend>
          {SCOPES.map(([k, label]) => (
            <label key={k} style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={scopes.includes(k)}
              onChange={(e) => setScopes(e.target.checked ? [...scopes, k] : scopes.filter((s) => s !== k))} /> {label}</label>))}
        </fieldset>
        <div className="form-actions" style={{ alignSelf: 'end' }}><button className="btn btn-primary" disabled={cmd.busy || scopes.length === 0}>Gerar chave</button></div>
      </form>
      {list.loading ? <Loading /> : list.error ? <ErrorBox error={list.error} onRetry={list.reload} /> : list.data!.length > 0 && (
        <div className="table-wrap" style={{ border: 0, marginTop: 16 }}><table className="table">
          <thead><tr><th>Nome</th><th>Chave</th><th>Permissões</th><th>Último uso</th><th className="num">24 h</th><th /></tr></thead>
          <tbody>{list.data!.map((k) => (
            <tr key={k.id}><td>{k.name}<div className="subtle">por {k.created_by_name}</div></td><td><code>{k.token_prefix}…</code></td>
              <td className="subtle">{k.scopes.join(', ')}</td><td>{formatInstant(k.last_used_at)}</td><td className="num">{k.requests_24h}</td>
              <td>{k.revoked_at ? <Status tone="neutral">Revogada</Status> : <button className="btn btn-sm" onClick={async () => {
                if (window.confirm(`Revogar “${k.name}”? A IA deixa de consultar o sistema na hora.`) && (await cmd.run('POST', `/api/v1/admin/agent-clients/${k.id}/revoke`, undefined, { success: 'Chave revogada.' }))) list.reload();
              }}>Revogar</button>}</td></tr>))}
          </tbody></table></div>)}
    </section>
  );
}
