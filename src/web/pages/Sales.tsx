import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { accessToken, api, describeError } from '../api';
import { PageHead, useCommand } from '../components/Shell';
import { Empty, ErrorBox, Field, Icon, Loading, Status, formatCents, formatDateOnly, formatInstant, parseMoneyInput, centsToInput, useLoad } from '../components/ui';
import { useSession } from '../session';

type QuoteItem = { id: string; product_id: string; unit_id: string | null; unit_code: string | null; quantity: number; unit_price_cents: string; discount_cents: string; description: string; line_total_cents: string };
type Quote = {
  id: string; series_id: string; revision: number; state: string; contact_id: string; contact_name: string; opportunity_id: string | null;
  owner_name: string; valid_until: string; expired: boolean; subtotal_cents: string; discount_cents: string; freight_cents: string; total_cents: string;
  version: number; items: QuoteItem[]; reservation: { id: string; state: string; expires_at: string; units: string[] | null } | null; order_id: string | null;
  revisions?: Array<{ id: string; revision: number; state: string; total_cents: string }>;
};
type Product = { id: string; name: string; sku: string; type: string; sale_price_cents: string | null; counts: { available: number | null } };
const STATE: Record<string, [string, 'ok' | 'warn' | 'info' | 'neutral' | 'danger']> = {
  DRAFT: ['Rascunho', 'info'], ACCEPTED: ['Aceita', 'ok'], SUPERSEDED: ['Substituída', 'neutral'], CANCELLED: ['Cancelada', 'danger'],
  CONFIRMED: ['Confirmado', 'ok'], CLOSED: ['Encerrado', 'neutral'],
};
const MODE: Record<string, string> = { PIX: 'Pix', BOLETO: 'Boleto', CARD: 'Cartão', KOIN_APP_PIX: 'Koin (Pix)' };
const COVERAGE: Record<string, string> = { NONE: 'Aguardando pagamento', PARTIAL: 'Pago parcialmente', FULL_CONFIRMED: 'Pago' };
const FISCAL: Record<string, string> = { NOT_PREPARED: 'Nota não preparada', DRAFT: 'Rascunho de nota', IN_REVIEW: 'Nota em revisão', APPROVED_INTERNALLY: 'Nota aprovada (não enviada)', AUTHORIZED_EXTERNAL: 'Nota autorizada' };

type Line = { product_id: string; name: string; price: string | null; quantity: string; discount: string };

/** Editor: cria (de contato/oportunidade) ou revisa proposta. Preço sempre vem do catálogo, no servidor. */
export function QuoteEditorPage() {
  const { id } = useParams();
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const existing = useLoad(() => (id ? api.get<Quote>(`/api/v1/quotes/${id}`) : Promise.resolve(null)), [id]);
  const policy = useLoad(() => api.get<{ revision: number } | null>('/api/v1/commercial-policy'), []);
  const [lines, setLines] = useState<Line[]>([]);
  const [freight, setFreight] = useState('');
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Product[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const cmd = useCommand();
  const contactId = existing.data?.contact_id ?? sp.get('contato');
  const oppId = existing.data?.opportunity_id ?? sp.get('oportunidade');
  useEffect(() => {
    if (existing.data) {
      setLines(existing.data.items.map((i) => ({ product_id: i.product_id, name: i.description, price: i.unit_price_cents, quantity: String(i.quantity), discount: centsToInput(i.discount_cents === '0' ? null : i.discount_cents) })));
      setFreight(centsToInput(existing.data.freight_cents === '0' ? null : existing.data.freight_cents));
    }
  }, [existing.data]);
  if (existing.loading || policy.loading) return <Loading rows={4} />;
  if (!policy.data) return <><PageHead title="Nova proposta" /><div className="alert alert-warn"><strong>Política comercial não configurada</strong>O proprietário precisa definir prazo de reserva, validade de proposta e limite de desconto em Configurações antes de vender.</div></>;
  if (!contactId) return <ErrorBox error="Abra a proposta a partir de um contato ou oportunidade." />;

  async function search() {
    setResults((await api.page<Product>(`/api/v1/catalog/products?limit=10&q=${encodeURIComponent(q)}`)).data);
  }
  async function save() {
    const items = [];
    for (const l of lines) {
      const d = parseMoneyInput(l.discount);
      const qty = Number(l.quantity);
      if (d === undefined || !Number.isInteger(qty) || qty < 1) return setErr(`Revise quantidade/desconto de ${l.name}.`);
      items.push({ product_id: l.product_id, quantity: qty, ...(d ? { discount_cents: d } : {}) });
    }
    const fr = parseMoneyInput(freight);
    if (fr === undefined) return setErr('Frete no formato 150,00.');
    if (!items.length) return setErr('Adicione ao menos um item.');
    setErr(null);
    const body: Record<string, unknown> = { contact_id: contactId, items, ...(fr ? { freight_cents: fr } : {}) };
    const r = existing.data
      ? await cmd.run<{ id: string }>('PATCH', `/api/v1/quotes/${existing.data.id}`, { ...body, expected_version: existing.data.version }, { success: 'Nova revisão salva.' })
      : await cmd.run<{ id: string }>('POST', '/api/v1/quotes', { ...body, ...(oppId ? { opportunity_id: oppId } : {}) }, { success: 'Proposta salva.' });
    if (r) nav(`/app/propostas/${r.id}`, { replace: true });
  }
  return (
    <>
      <PageHead title={existing.data ? `Revisar proposta (rev. ${existing.data.revision})` : 'Nova proposta'} subtitle="Os preços vêm do catálogo; descontos acima da sua alçada pedem aprovação do proprietário." />
      <section className="card">
        <div className="card-head"><h2>Itens</h2></div>
        {lines.length === 0 ? <p className="muted">Nenhum item.</p> : (
          <div className="table-wrap" style={{ border: 0 }}><table className="table">
            <thead><tr><th>Produto</th><th className="num">Preço</th><th>Qtd.</th><th>Desconto</th><th /></tr></thead>
            <tbody>{lines.map((l, i) => (
              <tr key={i}><td>{l.name}</td><td className="num">{formatCents(l.price)}</td>
                <td><input aria-label={`Quantidade de ${l.name}`} className="input" style={{ width: 80 }} inputMode="numeric" value={l.quantity} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, quantity: e.target.value.replace(/\D/g, '') } : x)))} /></td>
                <td><input aria-label={`Desconto de ${l.name}`} className="input" style={{ width: 130 }} inputMode="decimal" placeholder="0,00" value={l.discount} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, discount: e.target.value } : x)))} /></td>
                <td><button className="btn btn-sm btn-ghost" onClick={() => setLines(lines.filter((_, j) => j !== i))}>Remover</button></td></tr>))}</tbody>
          </table></div>
        )}
        <form className="toolbar" style={{ marginTop: 16 }} onSubmit={(e) => { e.preventDefault(); void search(); }}>
          <div className="field search"><label htmlFor="ps">Adicionar produto</label><input id="ps" className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Modelo ou SKU" /></div>
          <button className="btn"><Icon name="search" /> Buscar</button>
        </form>
        {results.length > 0 && <ul className="timeline" style={{ marginTop: 12 }}>{results.map((p) => (
          <li key={p.id}><span className="dot" /><div className="unit-row"><span style={{ flex: 1 }}>{p.name} <span className="subtle">{p.sku} · {formatCents(p.sale_price_cents)} · disponível {p.counts.available ?? '—'}</span></span>
            <button className="btn btn-sm" disabled={!p.sale_price_cents} onClick={() => { setLines([...lines, { product_id: p.id, name: p.name, price: p.sale_price_cents, quantity: '1', discount: '' }]); setResults([]); setQ(''); }}>
              {p.sale_price_cents ? 'Adicionar' : 'Sem preço'}</button></div></li>))}</ul>}
        <div className="form-grid" style={{ marginTop: 16, maxWidth: 260 }}>
          <Field label="Frete" optional>{(p) => <input {...p} className="input" inputMode="decimal" value={freight} onChange={(e) => setFreight(e.target.value)} placeholder="0,00" />}</Field>
        </div>
        {(err || cmd.error != null) && <div className="alert alert-danger" role="alert" style={{ marginTop: 16 }}>{err ?? describeError(cmd.error)}</div>}
        <div className="form-actions" style={{ marginTop: 16 }}><button className="btn" onClick={() => nav(-1)}>Cancelar</button><button className="btn btn-primary" disabled={cmd.busy} onClick={() => void save()}>Salvar proposta</button></div>
      </section>
    </>
  );
}

export function QuotePage() {
  const { id } = useParams();
  const q = useLoad(() => api.get<Quote>(`/api/v1/quotes/${id}`), [id]);
  const nav = useNavigate();
  const cmd = useCommand();
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  const [allocs, setAllocs] = useState<Array<{ mode: string; amount: string; due: string; inst: string }>>([]);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (q.data) setAllocs([{ mode: 'PIX', amount: centsToInput(q.data.total_cents), due: today, inst: '1' }]); }, [q.data?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (q.loading && !q.data) return <Loading rows={4} />;
  if (q.error || !q.data) return <ErrorBox error={q.error ?? ''} onRetry={q.reload} />;
  const d = q.data;
  const reserved = d.reservation?.state === 'ACTIVE' && Date.parse(d.reservation.expires_at) > Date.now();
  async function confirm() {
    const out = [];
    let sum = 0n;
    for (const a of allocs) {
      const c = parseMoneyInput(a.amount);
      if (!c) return setErr('Informe o valor de cada forma de pagamento.');
      sum += BigInt(c);
      out.push({ mode: a.mode, principal_cents: c, due_date: a.due, ...(a.mode === 'CARD' ? { installment_count: Number(a.inst) || 1 } : {}) });
    }
    if (sum !== BigInt(d.total_cents)) return setErr(`A soma (${formatCents(String(sum))}) precisa ser igual ao total ${formatCents(d.total_cents)}.`);
    setErr(null);
    const r = await cmd.run<{ id: string }>('POST', '/api/v1/orders', { quote_id: d.id, quote_version: d.version, allocations: out }, { success: 'Pedido confirmado.' });
    if (r) nav(`/app/vendas/${r.id}`);
  }
  return (
    <>
      <PageHead title={`Proposta · ${d.contact_name}`} subtitle={`Revisão ${d.revision} · válida até ${formatInstant(d.valid_until)}`}>
        <Status tone={STATE[d.state]?.[1] ?? 'neutral'}>{STATE[d.state]?.[0] ?? d.state}</Status>
        {d.state === 'DRAFT' && <Link className="btn" to={`/app/propostas/${d.id}/editar`}>Revisar</Link>}
        {d.order_id && <Link className="btn btn-primary" to={`/app/vendas/${d.order_id}`}>Ver pedido</Link>}
      </PageHead>
      {d.expired && d.state === 'DRAFT' && <div className="alert alert-warn">Proposta vencida. Faça uma revisão para renovar a validade.</div>}
      <div className="table-wrap"><table className="table">
        <thead><tr><th>Item</th><th className="num">Qtd.</th><th className="num">Preço</th><th className="num">Desconto</th><th className="num">Total</th></tr></thead>
        <tbody>{d.items.map((i) => <tr key={i.id}><td>{i.description}</td><td className="num">{i.quantity}</td><td className="num">{formatCents(i.unit_price_cents)}</td><td className="num">{i.discount_cents === '0' ? '—' : formatCents(i.discount_cents)}</td><td className="num">{formatCents(i.line_total_cents)}</td></tr>)}
          {d.freight_cents !== '0' && <tr><td colSpan={4}>Frete</td><td className="num">{formatCents(d.freight_cents)}</td></tr>}
          <tr><td colSpan={4}><strong>Total</strong></td><td className="num"><strong>{formatCents(d.total_cents)}</strong></td></tr></tbody>
      </table></div>
      {d.state === 'DRAFT' && !d.expired && (
        <div className="grid-2">
          <section className="card">
            <div className="card-head"><h2>1. Reserva</h2>{reserved && <Status tone="ok">Reservado</Status>}</div>
            {reserved ? <>
              <p>Reservado até <strong>{formatInstant(d.reservation!.expires_at)}</strong>{d.reservation!.units?.length ? <> · bikes {d.reservation!.units.join(', ')}</> : null}.</p>
              <button className="btn btn-sm" style={{ marginTop: 12 }} disabled={cmd.busy} onClick={async () => { if (await cmd.run('POST', `/api/v1/quotes/${d.id}/reservation-release`, undefined, { success: 'Reserva liberada.' })) q.reload(); }}>Liberar reserva</button>
            </> : <>
              <p className="muted">Separa as unidades para este cliente pelo prazo da política. Sem reserva, não confirma pedido.</p>
              <button className="btn btn-primary" style={{ marginTop: 12 }} disabled={cmd.busy} onClick={async () => { if (await cmd.run('POST', '/api/v1/reservations', { quote_id: d.id, quote_version: d.version }, { success: 'Estoque reservado.' })) q.reload(); }}>Reservar estoque</button>
            </>}
          </section>
          <section className="card">
            <div className="card-head"><h2>2. Condições de pagamento</h2></div>
            <div style={{ display: 'grid', gap: 12 }}>
              {allocs.map((a, i) => (
                <div key={i} className="form-grid">
                  <Field label="Forma">{(p) => <select {...p} className="input" value={a.mode} onChange={(e) => setAllocs(allocs.map((x, j) => (j === i ? { ...x, mode: e.target.value } : x)))}>
                    {Object.entries(MODE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>}</Field>
                  <Field label="Valor">{(p) => <input {...p} className="input" inputMode="decimal" value={a.amount} onChange={(e) => setAllocs(allocs.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} />}</Field>
                  <Field label="Vencimento">{(p) => <input {...p} type="date" className="input" value={a.due} onChange={(e) => setAllocs(allocs.map((x, j) => (j === i ? { ...x, due: e.target.value } : x)))} />}</Field>
                  {a.mode === 'CARD' && <Field label="Parcelas">{(p) => <input {...p} className="input" inputMode="numeric" value={a.inst} onChange={(e) => setAllocs(allocs.map((x, j) => (j === i ? { ...x, inst: e.target.value.replace(/\D/g, '') } : x)))} />}</Field>}
                </div>))}
              <div className="unit-row">
                <button className="btn btn-sm" onClick={() => setAllocs([...allocs, { mode: 'PIX', amount: '', due: today, inst: '1' }])}>+ Outra forma</button>
                {allocs.length > 1 && <button className="btn btn-sm btn-ghost" onClick={() => setAllocs(allocs.slice(0, -1))}>Remover última</button>}
              </div>
              {(err || cmd.error != null) && <div className="alert alert-danger" role="alert">{err ?? describeError(cmd.error)}</div>}
              <button className="btn btn-primary" disabled={!reserved || cmd.busy} onClick={() => void confirm()}>Confirmar pedido</button>
              <p className="subtle">Confirmar registra a venda e compromete o estoque. A cobrança é gerada pelo provedor de pagamento (ainda não habilitado).</p>
            </div>
          </section>
        </div>
      )}
      {d.revisions && d.revisions.length > 1 && <p className="subtle">Revisões: {d.revisions.map((r) => `rev. ${r.revision} (${STATE[r.state]?.[0]})`).join(' · ')}</p>}
    </>
  );
}

type Order = {
  id: string; display_number: number; confirmed_at: string; seller: { id: string; name: string }; contact_id: string; customer: { name: string; mobile: string | null; email: string | null };
  commercial_state: string; coverage_state: string; delivery_state: string; fiscal_state: string; total_cents: string; item_count: number; version: number; quote_id: string; cancelled_reason: string | null;
  items?: Array<{ position: number; description: string; unit_code: string | null; serial_number: string | null; quantity: number; unit_price_cents: string; discount_cents: string; line_total_cents: string; cost_snapshot_cents?: string | null }>;
  allocations?: Array<{ id: string; mode: string; installment_count: number | null; principal_cents: string; due_date: string; state: string }>;
  commission_target_cents?: string;
};

export function SalesPage() {
  const { session } = useSession();
  const [cursor, setCursor] = useState<string | null>(null);
  const [period, setPeriod] = useState({ from: '', to: '' });
  const qs = new URLSearchParams({ limit: '50', ...(cursor ? { cursor } : {}), ...(period.from ? { from: period.from } : {}), ...(period.to ? { to: period.to } : {}) });
  const list = useLoad(() => fetchOrders(`/api/v1/orders?${qs}`), [qs.toString()]);
  return (
    <>
      <PageHead title="Registro de vendas" subtitle={session?.profile === 'OWNER' ? 'Todas as vendas da loja.' : 'Suas vendas.'} />
      <div className="toolbar">
        <Field label="De">{(p) => <input {...p} type="date" className="input" value={period.from} onChange={(e) => { setCursor(null); setPeriod({ ...period, from: e.target.value }); }} />}</Field>
        <Field label="Até (exclusive)">{(p) => <input {...p} type="date" className="input" value={period.to} onChange={(e) => { setCursor(null); setPeriod({ ...period, to: e.target.value }); }} />}</Field>
      </div>
      {list.data && <div className="stats"><div className="stat"><div className="k">Pedidos (sem cancelados)</div><div className="v">{list.data.totals.count}</div></div>
        <div className="stat"><div className="k">Valor vendido</div><div className="v">{formatCents(list.data.totals.total_cents)}</div></div></div>}
      {list.loading ? <Loading /> : list.error ? <ErrorBox error={list.error} onRetry={list.reload} /> : !list.data?.data.length ? <Empty title="Nenhuma venda no período." /> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Nº</th><th>Data</th><th>Cliente</th><th>Vendedor</th><th>Pedido</th><th>Pagamento</th><th>Nota</th><th className="num">Total</th></tr></thead>
          <tbody>{list.data.data.map((o) => (
            <tr key={o.id}><td><Link className="row-link" to={`/app/vendas/${o.id}`}>#{o.display_number}</Link></td><td className="subtle">{formatInstant(o.confirmed_at)}</td>
              <td>{o.customer.name}</td><td>{o.seller.name}</td>
              <td><Status tone={STATE[o.commercial_state]?.[1] ?? 'neutral'}>{STATE[o.commercial_state]?.[0] ?? o.commercial_state}</Status></td>
              <td><Status tone={o.coverage_state === 'FULL_CONFIRMED' ? 'ok' : 'warn'}>{COVERAGE[o.coverage_state] ?? o.coverage_state}</Status></td>
              <td><Status tone={o.fiscal_state === 'AUTHORIZED_EXTERNAL' ? 'ok' : 'neutral'}>{FISCAL[o.fiscal_state]}</Status></td>
              <td className="num">{formatCents(o.total_cents)}</td></tr>))}</tbody>
        </table></div>
      )}
      {list.data?.page.has_more && <button className="btn" onClick={() => setCursor(list.data!.page.next_cursor)}>Próxima página</button>}
    </>
  );
}

async function fetchOrders(path: string) {
  const t = await accessToken();
  const r = await fetch(path, { headers: t ? { authorization: `Bearer ${t}` } : {} });
  const j = (await r.json()) as any;
  if (!r.ok) throw new Error(j.message ?? 'Erro');
  return j as { data: Order[]; totals: { count: number; total_cents: string }; page: { next_cursor: string | null; has_more: boolean } };
}

export function OrderPage() {
  const { id } = useParams();
  const { session } = useSession();
  const o = useLoad(() => api.get<Order>(`/api/v1/orders/${id}`), [id]);
  const cmd = useCommand();
  const [reason, setReason] = useState('');
  if (o.loading && !o.data) return <Loading rows={4} />;
  if (o.error || !o.data) return <ErrorBox error={o.error ?? ''} onRetry={o.reload} />;
  const d = o.data;
  return (
    <>
      <PageHead title={`Pedido #${d.display_number}`} subtitle={`${formatInstant(d.confirmed_at)} · ${d.seller.name}`}>
        <Status tone={STATE[d.commercial_state]?.[1] ?? 'neutral'}>{STATE[d.commercial_state]?.[0]}</Status>
        <Link className="btn" to={`/app/propostas/${d.quote_id}`}>Proposta</Link>
      </PageHead>
      <div className="stats">
        <div className="stat"><div className="k">Total</div><div className="v">{formatCents(d.total_cents)}</div></div>
        <div className="stat"><div className="k">Pagamento</div><div className="v" style={{ fontSize: 16 }}>{COVERAGE[d.coverage_state]}</div></div>
        <div className="stat"><div className="k">Entrega</div><div className="v" style={{ fontSize: 16 }}>{d.delivery_state === 'DELIVERED' ? 'Entregue' : 'Pendente'}</div></div>
        <div className="stat"><div className="k">Nota fiscal</div><div className="v" style={{ fontSize: 16 }}>{FISCAL[d.fiscal_state]}</div></div>
      </div>
      {d.cancelled_reason && <div className="alert alert-danger"><strong>Cancelado</strong>{d.cancelled_reason}</div>}
      <div className="grid-2">
        <section className="card">
          <div className="card-head"><h2>Cliente</h2><Link to={`/app/contatos/${d.contact_id}`} className="subtle">Cadastro</Link></div>
          <dl className="kv"><dt>Nome</dt><dd>{d.customer.name}</dd><dt>Celular</dt><dd>{d.customer.mobile ?? '—'}</dd><dt>E-mail</dt><dd>{d.customer.email ?? '—'}</dd></dl>
          <p className="subtle" style={{ marginTop: 8 }}>Dados congelados na confirmação.</p>
        </section>
        <section className="card">
          <div className="card-head"><h2>Condições</h2></div>
          <ul className="timeline">{d.allocations?.map((a) => (
            <li key={a.id}><span className="dot" /><div>{MODE[a.mode]}{a.installment_count ? ` em ${a.installment_count}x` : ''} · <strong>{formatCents(a.principal_cents)}</strong>
              <div className="subtle">Vence {formatDateOnly(a.due_date)} · {a.state === 'CANCELLED' ? 'cancelada' : 'cobrança ainda não gerada (provedor pendente)'}</div></div></li>))}</ul>
        </section>
      </div>
      <div className="table-wrap"><table className="table">
        <thead><tr><th>Item</th><th>Unidade</th><th className="num">Qtd.</th><th className="num">Total</th>{session?.profile === 'OWNER' && <th className="num">Custo</th>}</tr></thead>
        <tbody>{d.items?.map((i) => <tr key={i.position}><td>{i.description}</td><td className="mono">{i.unit_code ?? '—'}{i.serial_number ? ` · ${i.serial_number}` : ''}</td>
          <td className="num">{i.quantity}</td><td className="num">{formatCents(i.line_total_cents)}</td>
          {session?.profile === 'OWNER' && <td className="num">{i.cost_snapshot_cents ? formatCents(i.cost_snapshot_cents) : 'não informado'}</td>}</tr>)}</tbody>
      </table></div>
      <div className="alert">A entrega só é liberada após confirmação oficial do pagamento pelo provedor — ainda não habilitado neste ambiente.</div>
      {session?.profile === 'OWNER' && d.commercial_state === 'CONFIRMED' && d.coverage_state === 'NONE' && (
        <section className="card">
          <div className="card-head"><h2>Cancelar pedido</h2></div>
          <p className="muted">Sem pagamento registrado: as unidades voltam ao estoque e as condições são canceladas. O pedido permanece no registro.</p>
          <div className="toolbar" style={{ marginTop: 12 }}>
            <div className="field search"><label htmlFor="cr">Motivo</label><input id="cr" className="input" value={reason} onChange={(e) => setReason(e.target.value)} /></div>
            <button className="btn btn-danger" disabled={!reason.trim() || cmd.busy} onClick={async () => { if (await cmd.run('POST', `/api/v1/orders/${d.id}/cancellations`, { expected_version: d.version, reason }, { success: 'Pedido cancelado.' })) o.reload(); }}>Cancelar pedido</button>
          </div>
        </section>
      )}
    </>
  );
}
