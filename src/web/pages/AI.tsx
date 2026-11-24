// Visitas agendadas (IA ou loja) e painel de resultados/comissão da IA.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, describeError } from '../api';
import { PageHead, useCommand } from '../components/Shell';
import { Empty, ErrorBox, Field, Loading, Status, formatCents, formatInstant, useLoad, waLink } from '../components/ui';

type Visit = { id: string; contact_id: string; contact_name: string; mobile_phone: string | null; opportunity_id: string | null; scheduled_at: string;
  state: 'SCHEDULED' | 'ATTENDED' | 'NO_SHOW' | 'CANCELLED'; source: string; note: string | null; interest_product: string | null; seller_name: string; version: number };
const VSTATE = { SCHEDULED: ['info', 'Agendada'], ATTENDED: ['ok', 'Compareceu'], NO_SHOW: ['danger', 'Não veio'], CANCELLED: ['neutral', 'Cancelada'] } as const;

const ymd = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d);

export function VisitsPage() {
  const [range, setRange] = useState<'today' | 'week' | 'past'>('week');
  const now = new Date();
  const q = range === 'today' ? `from=${ymd(now)}&to=${ymd(new Date(+now + 86400000))}`
    : range === 'week' ? `from=${ymd(now)}&to=${ymd(new Date(+now + 7 * 86400000))}` : `from=${ymd(new Date(+now - 30 * 86400000))}&to=${ymd(new Date(+now + 86400000))}`;
  const list = useLoad(() => api.get<Visit[]>(`/api/v1/visits?${q}`), [q]);
  const cmd = useCommand();
  const set = async (v: Visit, state: Visit['state']) => {
    if (await cmd.run('POST', `/api/v1/visits/${v.id}/state`, { expected_version: v.version, state }, { success: 'Visita atualizada.' })) list.reload();
  };
  const confirmMsg = (v: Visit) => `Oi ${v.contact_name.split(' ')[0]}! Confirmando sua visita na Ninebike ${formatInstant(v.scheduled_at)}${v.interest_product ? ` para conhecer a ${v.interest_product}` : ''}. Te esperamos! 🚲⚡`;
  return (
    <>
      <PageHead title="Visitas" />
      <div className="toolbar" role="tablist" style={{ marginBottom: 16 }}>
        {([['today', 'Hoje'], ['week', 'Próximos 7 dias'], ['past', 'Últimos 30 dias']] as const).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={range === k} className={`btn ${range === k ? 'btn-primary' : ''}`} onClick={() => setRange(k)}>{l}</button>))}
      </div>
      {list.loading ? <Loading /> : list.error ? <ErrorBox error={list.error} onRetry={list.reload} /> : !list.data!.length ? <Empty title="Nenhuma visita neste período." /> : (
        <section className="card"><div className="table-wrap" style={{ border: 0 }}><table className="table">
          <thead><tr><th>Quando</th><th>Cliente</th><th>Interesse</th><th>Origem</th><th>Situação</th><th /></tr></thead>
          <tbody>{list.data!.map((v) => (
            <tr key={v.id}>
              <td>{formatInstant(v.scheduled_at)}</td>
              <td><Link to={`/app/contatos/${v.contact_id}`}>{v.contact_name}</Link><div className="subtle">{v.seller_name}</div></td>
              <td>{v.interest_product ?? '—'}{v.note && <div className="subtle">{v.note}</div>}</td>
              <td>{v.source === 'whatsapp_ai' ? <Status tone="info">IA</Status> : 'Loja'}</td>
              <td><Status tone={VSTATE[v.state][0]}>{VSTATE[v.state][1]}</Status></td>
              <td><div className="unit-row">
                {v.state === 'SCHEDULED' && <>
                  <button className="btn btn-sm btn-primary" disabled={cmd.busy} onClick={() => void set(v, 'ATTENDED')}>Compareceu</button>
                  <button className="btn btn-sm" disabled={cmd.busy} onClick={() => void set(v, 'NO_SHOW')}>Não veio</button>
                  {v.mobile_phone && <a className="btn btn-sm" target="_blank" rel="noreferrer" href={`${waLink(v.mobile_phone)}?text=${encodeURIComponent(confirmMsg(v))}`}>Confirmar</a>}
                </>}
              </div></td>
            </tr>))}</tbody>
        </table></div></section>)}
      {cmd.error != null && <div className="alert alert-danger" role="alert">{describeError(cmd.error)}</div>}
    </>
  );
}

type Charge = { id: string; contact_id: string; contact_name: string; kind: 'PIX' | 'LINK'; provider: string; amount_cents: string; description: string; url: string | null;
  state: string; paid_reported_at: string | null; paid_amount_cents: string | null; confirmation: 'PENDING' | 'CONFIRMED' | 'REJECTED'; order_number: number | null; created_at: string; version: number };
type Report = { rule: { version: number; bps: number; window_days: number } | null; customers_attributed: number; leads: number;
  visits: { scheduled: number; attended: number; no_show: number }; charges_created: number;
  orders: Array<{ order_id: string; number: number; confirmed_at: string; customer_name: string; base_cents: string; reason: string; seller_name: string; contact_id: string }>;
  paid_charges_without_order: Charge[]; base_orders_cents: string; base_charges_confirmed_cents: string; base_charges_pending_cents: string;
  commission_confirmed_cents: string | null; commission_pending_cents: string | null };
const REASON: Record<string, string> = { LEAD: 'Lead', VISIT: 'Visita', PAYMENT: 'Cobrança', MANUAL: 'Manual' };
const CSTATE: Record<string, [string, string]> = { CREATED: ['warn', 'Aguardando'], PAID_REPORTED: ['info', 'Pago (informado)'], EXPIRED: ['neutral', 'Expirou'], CANCELLED: ['neutral', 'Cancelada'] };

export function AIResultsPage() {
  const first = `${ymd(new Date()).slice(0, 7)}-01`;
  const [from, setFrom] = useState(first);
  const [to, setTo] = useState(ymd(new Date(Date.now() + 86400000)));
  const rep = useLoad(() => api.get<Report>(`/api/v1/reports/ai?from=${from}&to=${to}`), [from, to]);
  const charges = useLoad(() => api.get<Charge[]>(`/api/v1/ai-charges?from=${from}&to=${to}`), [from, to]);
  const cmd = useCommand();
  const [rule, setRule] = useState({ pct: '', days: '90' });
  const r = rep.data;
  const review = async (c: Charge, confirmation: 'CONFIRMED' | 'REJECTED') => {
    const note = confirmation === 'REJECTED' ? window.prompt('Motivo (ex.: não caiu no banco)') : undefined;
    if (confirmation === 'REJECTED' && !note) return;
    if (await cmd.run('POST', `/api/v1/ai-charges/${c.id}/review`, { expected_version: c.version, confirmation, ...(note ? { note } : {}) }, { success: 'Cobrança revisada.' })) { rep.reload(); charges.reload(); }
  };
  return (
    <>
      <PageHead title="Resultados da IA" />
      <div className="toolbar" style={{ marginBottom: 16 }}>
        <Field label="De">{(p) => <input {...p} type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />}</Field>
        <Field label="Até">{(p) => <input {...p} type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} />}</Field>
      </div>
      {rep.loading ? <Loading /> : rep.error ? <ErrorBox error={rep.error} onRetry={rep.reload} /> : r && (<>
        <div className="stats">
          <div className="stat"><div className="k">Clientes trazidos</div><div className="v">{r.customers_attributed}</div></div>
          <div className="stat"><div className="k">Visitas</div><div className="v">{r.visits.scheduled}</div><div className="subtle">{r.visits.attended} compareceram</div></div>
          <div className="stat"><div className="k">Vendas atribuídas</div><div className="v money">{formatCents(r.base_orders_cents)}</div><div className="subtle">{r.orders.length} pedido(s)</div></div>
          <div className="stat"><div className="k">Comissão confirmada</div><div className="v money">{r.commission_confirmed_cents ? formatCents(r.commission_confirmed_cents) : '—'}</div>
            {r.rule ? <div className="subtle">{r.rule.bps / 100}% · janela {r.rule.window_days} dias</div> : <div className="subtle">Regra não definida</div>}</div>
          <div className="stat"><div className="k">A confirmar</div><div className="v money">{r.commission_pending_cents ? formatCents(r.commission_pending_cents) : '—'}</div><div className="subtle">pagamentos informados</div></div>
        </div>
        <section className="card">
          <div className="card-head"><h2>Vendas de clientes trazidos pela IA</h2></div>
          {!r.orders.length ? <Empty title="Nenhuma venda atribuída no período." /> : (
            <div className="table-wrap" style={{ border: 0 }}><table className="table">
              <thead><tr><th>Pedido</th><th>Data</th><th>Cliente</th><th>Vendedor</th><th>Origem</th><th className="num">Valor (sem frete)</th><th /></tr></thead>
              <tbody>{r.orders.map((o) => (
                <tr key={o.order_id}><td><Link to={`/app/vendas/${o.order_id}`}>#{o.number}</Link></td><td>{formatInstant(o.confirmed_at)}</td>
                  <td>{o.customer_name}</td><td>{o.seller_name}</td><td><Status tone="info">{REASON[o.reason]}</Status></td><td className="num">{formatCents(o.base_cents)}</td>
                  <td><button className="btn btn-ghost btn-sm" onClick={async () => {
                    const reason = window.prompt('Por que este cliente não deve contar para a IA?'); if (!reason) return;
                    if (await cmd.run('POST', `/api/v1/ai-attributions/${o.contact_id}/removal`, { reason }, { success: 'Atribuição removida.' })) rep.reload();
                  }}>Contestar</button></td></tr>))}</tbody></table></div>)}
        </section>
      </>)}
      <section className="card">
        <div className="card-head"><h2>Pix e links gerados pela IA</h2></div>
        {charges.loading ? <Loading /> : !charges.data?.length ? <Empty title="Nenhuma cobrança no período." /> : (
          <div className="table-wrap" style={{ border: 0 }}><table className="table">
            <thead><tr><th>Data</th><th>Cliente</th><th>Descrição</th><th className="num">Valor</th><th>Situação</th><th>Conferência</th><th /></tr></thead>
            <tbody>{charges.data.map((c) => (
              <tr key={c.id}><td>{formatInstant(c.created_at)}</td><td><Link to={`/app/contatos/${c.contact_id}`}>{c.contact_name}</Link></td>
                <td>{c.kind === 'PIX' ? 'Pix' : 'Link'} · {c.description}<div className="subtle">{c.provider}{c.order_number ? ` · pedido #${c.order_number}` : ''}</div></td>
                <td className="num">{formatCents(c.paid_amount_cents ?? c.amount_cents)}</td>
                <td><Status tone={(CSTATE[c.state]?.[0] ?? 'neutral') as 'info'}>{CSTATE[c.state]?.[1] ?? c.state}</Status></td>
                <td>{c.confirmation === 'CONFIRMED' ? <Status tone="ok">Confirmado</Status> : c.confirmation === 'REJECTED' ? <Status tone="danger">Recusado</Status> : <span className="subtle">Pendente</span>}</td>
                <td>{c.state === 'PAID_REPORTED' && c.confirmation === 'PENDING' && <div className="unit-row">
                  <button className="btn btn-sm btn-primary" disabled={cmd.busy} onClick={() => void review(c, 'CONFIRMED')}>Caiu na conta</button>
                  <button className="btn btn-sm" disabled={cmd.busy} onClick={() => void review(c, 'REJECTED')}>Não caiu</button></div>}</td></tr>))}
            </tbody></table></div>)}
      </section>
      <section className="card">
        <div className="card-head"><h2>Regra de comissão da IA</h2>{r?.rule && <Status tone="ok">Versão {r.rule.version}</Status>}</div>
        <p className="subtle" style={{ marginBottom: 12 }}>Percentual sobre vendas (sem frete) de clientes trazidos pela IA dentro da janela, mais cobranças da IA pagas que não viraram pedido.</p>
        <form className="form-grid" onSubmit={async (e) => {
          e.preventDefault();
          const body = { expected_version: r?.rule?.version ?? 0, bps: Math.round(Number(rule.pct.replace(',', '.')) * 100), window_days: Number(rule.days) };
          if (await cmd.run('POST', '/api/v1/admin/ai-commission-rules', body, { success: 'Regra salva.' })) rep.reload();
        }}>
          <Field label="Comissão (%)">{(p) => <input {...p} className="input" inputMode="decimal" required value={rule.pct} onChange={(e) => setRule({ ...rule, pct: e.target.value })} placeholder={r?.rule ? String(r.rule.bps / 100) : '5'} />}</Field>
          <Field label="Janela (dias)" help="Quanto tempo depois do 1º contato a venda ainda conta">{(p) => <input {...p} className="input" type="number" min={1} max={730} value={rule.days} onChange={(e) => setRule({ ...rule, days: e.target.value })} />}</Field>
          <div className="form-actions" style={{ alignSelf: 'end' }}><button className="btn btn-primary" disabled={cmd.busy}>Salvar</button></div>
        </form>
      </section>
      {cmd.error != null && <div className="alert alert-danger" role="alert">{describeError(cmd.error)}</div>}
    </>
  );
}
