// Venda rápida de balcão, caixa do dia e recebimentos do pedido.
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, describeError } from '../api';
import { PageHead, useCommand } from '../components/Shell';
import { Dialog, Empty, Field, Loading, Status, formatCents, formatInstant, formatPhone, parseMoneyInput, useLoad } from '../components/ui';
import { useSession } from '../session';

export const METHODS: Record<string, string> = { CASH: 'Dinheiro', PIX: 'Pix', DEBIT: 'Débito', CREDIT: 'Crédito', TRANSFER: 'Transferência', BOLETO: 'Boleto', OTHER: 'Outro' };
const KINDS: Record<string, string> = { SALE: 'Venda', RECEIPT: 'Recebimento', SUPPLY: 'Suprimento', WITHDRAWAL: 'Sangria', EXPENSE: 'Despesa', OTHER: 'Outro' };
const toCents = (s: string) => parseMoneyInput(s) ?? '0';
const sum = (xs: string[]) => xs.reduce((a, b) => a + BigInt(b || '0'), 0n);

type Product = { id: string; name: string; sku: string; type: string; sale_price_cents: string | null; counts: { available: number | null } };
type Contact = { id: string; name: string; mobile_phone: string | null };
type Line = { product: Product; quantity: number; discount: string };
type Pay = { method: string; amount: string; installments: number; received: boolean };

export function QuickSalePage() {
  const nav = useNavigate();
  const cmd = useCommand();
  const [cq, setCq] = useState('');
  const [contact, setContact] = useState<Contact | null>(null);
  const [newC, setNewC] = useState<{ name: string; phone: string } | null>(null);
  const [pq, setPq] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [freight, setFreight] = useState('');
  const [pays, setPays] = useState<Pay[]>([{ method: 'PIX', amount: '', installments: 1, received: true }]);
  const contacts = useLoad(() => (cq.trim().length >= 2 ? api.page<Contact>(`/api/v1/contacts?q=${encodeURIComponent(cq)}&limit=8`).then((r) => r.data) : Promise.resolve([])), [cq]);
  const products = useLoad(() => (pq.trim().length >= 2 ? api.page<Product>(`/api/v1/catalog/products?q=${encodeURIComponent(pq)}&limit=8`).then((r) => r.data) : Promise.resolve([])), [pq]);

  const total = useMemo(() => lines.reduce((a, l) => a + BigInt(l.product.sale_price_cents ?? '0') * BigInt(l.quantity) - BigInt(toCents(l.discount)), 0n) + BigInt(toCents(freight)), [lines, freight]);
  const paid = sum(pays.map((p) => toCents(p.amount)));
  const missing = total - paid;
  useEffect(() => { if (pays.length === 1 && !pays[0].amount && total > 0n) setPays([{ ...pays[0], amount: formatCents(total.toString()).replace('R$ ', '').trim() }]); }, [total]); // eslint-disable-line

  async function createContact() {
    if (!newC) return;
    const r = await cmd.run<{ id: string }>('POST', '/api/v1/contacts', { name: newC.name, mobile_phone: newC.phone });
    if (r) { setContact({ id: r.id, name: newC.name, mobile_phone: newC.phone }); setNewC(null); }
  }
  async function finish() {
    if (!contact) return;
    const body = { contact_id: contact.id, items: lines.map((l) => ({ product_id: l.product.id, quantity: l.quantity, ...(toCents(l.discount) !== '0' ? { discount_cents: toCents(l.discount) } : {}) })),
      ...(toCents(freight) !== '0' ? { freight_cents: toCents(freight) } : {}),
      payments: pays.map((p) => ({ method: p.method, amount_cents: toCents(p.amount), received: p.received, ...(p.method === 'CREDIT' ? { installments: p.installments } : {}) })) };
    const r = await cmd.run<{ id: string; display_number: number }>('POST', '/api/v1/quick-sales', body, { success: 'Venda registrada.' });
    if (r) nav(`/app/vendas/${r.id}`);
  }

  return (
    <>
      <PageHead title="Venda rápida" />
      <div className="grid-2">
        <section className="card">
          <div className="card-head"><h2>Cliente</h2></div>
          {contact ? (
            <div className="unit-row"><strong style={{ flex: 1 }}>{contact.name} <span className="subtle">{formatPhone(contact.mobile_phone)}</span></strong>
              <button className="btn btn-sm" onClick={() => setContact(null)}>Trocar</button></div>
          ) : newC ? (
            <div className="form-grid">
              <Field label="Nome">{(p) => <input {...p} className="input" value={newC.name} onChange={(e) => setNewC({ ...newC, name: e.target.value })} />}</Field>
              <Field label="Celular">{(p) => <input {...p} className="input" inputMode="tel" value={newC.phone} onChange={(e) => setNewC({ ...newC, phone: e.target.value })} placeholder="(11) 99999-9999" />}</Field>
              <div className="form-actions"><button className="btn" onClick={() => setNewC(null)}>Cancelar</button><button className="btn btn-primary" disabled={cmd.busy} onClick={() => void createContact()}>Cadastrar</button></div>
            </div>
          ) : (<>
            <Field label="Buscar por nome ou celular">{(p) => <input {...p} className="input" autoFocus value={cq} onChange={(e) => setCq(e.target.value)} />}</Field>
            <ul className="timeline" style={{ marginTop: 8 }}>{contacts.data?.map((c) => (
              <li key={c.id}><span className="dot" /><button className="btn btn-ghost btn-sm" onClick={() => setContact(c)}>{c.name} <span className="subtle">{formatPhone(c.mobile_phone)}</span></button></li>))}</ul>
            <button className="btn btn-sm" onClick={() => setNewC({ name: cq, phone: '' })}>+ Cliente novo</button>
          </>)}
        </section>
        <section className="card">
          <div className="card-head"><h2>Produtos</h2></div>
          <Field label="Buscar produto">{(p) => <input {...p} className="input" value={pq} onChange={(e) => setPq(e.target.value)} placeholder="nome, marca ou SKU" />}</Field>
          <ul className="timeline" style={{ marginTop: 8 }}>{products.data?.map((p) => (
            <li key={p.id}><span className="dot" /><button className="btn btn-ghost btn-sm" disabled={!p.sale_price_cents || !p.counts.available}
              onClick={() => { setLines([...lines.filter((l) => l.product.id !== p.id), { product: p, quantity: 1, discount: '' }]); setPq(''); }}>
              {p.name} <span className="subtle">{formatCents(p.sale_price_cents)} · {p.counts.available ?? '?'} disp.</span></button></li>))}</ul>
        </section>
      </div>
      <section className="card">
        <div className="card-head"><h2>Itens</h2><strong>{formatCents(total.toString())}</strong></div>
        {!lines.length ? <Empty title="Adicione produtos." /> : (
          <div className="table-wrap" style={{ border: 0 }}><table className="table">
            <thead><tr><th>Produto</th><th className="num">Preço</th><th>Qtd.</th><th>Desconto (R$)</th><th /></tr></thead>
            <tbody>{lines.map((l, i) => (
              <tr key={l.product.id}><td>{l.product.name}</td><td className="num">{formatCents(l.product.sale_price_cents)}</td>
                <td><input className="input" style={{ width: 70 }} type="number" min={1} max={l.product.type === 'BIKE' ? (l.product.counts.available ?? 1) : 50} value={l.quantity}
                  onChange={(e) => { const n = [...lines]; n[i] = { ...l, quantity: Math.max(1, Number(e.target.value)) }; setLines(n); }} /></td>
                <td><input className="input" style={{ width: 120 }} inputMode="decimal" value={l.discount} onChange={(e) => { const n = [...lines]; n[i] = { ...l, discount: e.target.value }; setLines(n); }} /></td>
                <td><button className="btn btn-ghost btn-sm" onClick={() => setLines(lines.filter((_, j) => j !== i))}>Remover</button></td></tr>))}</tbody>
          </table></div>)}
        <div style={{ maxWidth: 200, marginTop: 12 }}><Field label="Frete (R$)" optional>{(p) => <input {...p} className="input" inputMode="decimal" value={freight} onChange={(e) => setFreight(e.target.value)} />}</Field></div>
      </section>
      <section className="card">
        <div className="card-head"><h2>Pagamento</h2>
          {missing !== 0n && lines.length > 0 && <Status tone={missing > 0n ? 'warn' : 'danger'}>{missing > 0n ? `Falta ${formatCents(missing.toString())}` : `Passou ${formatCents((-missing).toString())}`}</Status>}</div>
        {pays.map((p, i) => (
          <div className="form-grid" key={i} style={{ marginBottom: 8 }}>
            <Field label="Forma">{(x) => <select {...x} className="input" value={p.method} onChange={(e) => { const n = [...pays]; n[i] = { ...p, method: e.target.value }; setPays(n); }}>
              {['PIX', 'CASH', 'DEBIT', 'CREDIT', 'TRANSFER', 'BOLETO'].map((m) => <option key={m} value={m}>{METHODS[m]}</option>)}</select>}</Field>
            <Field label="Valor (R$)">{(x) => <input {...x} className="input" inputMode="decimal" value={p.amount} onChange={(e) => { const n = [...pays]; n[i] = { ...p, amount: e.target.value }; setPays(n); }} />}</Field>
            {p.method === 'CREDIT' && <Field label="Parcelas">{(x) => <input {...x} className="input" type="number" min={1} max={24} value={p.installments} onChange={(e) => { const n = [...pays]; n[i] = { ...p, installments: Number(e.target.value) }; setPays(n); }} />}</Field>}
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', alignSelf: 'end' }}><input type="checkbox" checked={p.received} onChange={(e) => { const n = [...pays]; n[i] = { ...p, received: e.target.checked }; setPays(n); }} /> Recebido agora</label>
            {pays.length > 1 && <button className="btn btn-ghost btn-sm" style={{ alignSelf: 'end' }} onClick={() => setPays(pays.filter((_, j) => j !== i))}>Remover</button>}
          </div>))}
        <button className="btn btn-sm" onClick={() => setPays([...pays, { method: 'CASH', amount: missing > 0n ? formatCents(missing.toString()).replace('R$ ', '').trim() : '', installments: 1, received: true }])}>+ Outra forma</button>
        <div className="form-actions" style={{ marginTop: 16 }}>
          <button className="btn btn-primary" disabled={!contact || !lines.length || missing !== 0n || cmd.busy} onClick={() => void finish()}>
            {cmd.busy ? 'Registrando…' : `Confirmar venda de ${formatCents(total.toString())}`}</button>
        </div>
        {cmd.error != null && <div className="alert alert-danger" role="alert" style={{ marginTop: 12 }}>{describeError(cmd.error)}</div>}
      </section>
    </>
  );
}

type Entry = { id: string; direction: 'IN' | 'OUT'; kind: string; method: string; installments: number | null; amount_cents: string; description: string;
  order_id: string | null; by: string; created_at: string; reversed_at: string | null; reversed_reason: string | null };
type Day = { business_date: string; session: null | { opening_cents: string; opened_by: string; opened_at: string; closed_at: string | null; closed_by: string | null;
  counted_cents: string | null; expected_cash_cents: string | null; close_note: string | null };
  entries: Entry[]; by_method: Array<{ method: string; in_cents: string; out_cents: string }>; expected_cash_now_cents?: string };

export function CashPage() {
  const { session: me } = useSession();
  const isOwner = me?.profile === 'OWNER';
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  const [day, setDay] = useState(today);
  const d = useLoad(() => api.get<Day>(`/api/v1/cash?date=${day}`), [day]);
  const cmd = useCommand();
  const [dlg, setDlg] = useState<null | 'open' | 'entry' | 'close'>(null);
  const [f, setF] = useState({ amount: '', direction: 'OUT', kind: 'WITHDRAWAL', method: 'CASH', description: '', note: '' });
  const s = d.data?.session;
  const isToday = day === today;
  const done = async (r: unknown) => { if (r) { setDlg(null); setF({ ...f, amount: '', description: '', note: '' }); d.reload(); } };
  const totalIn = sum((d.data?.by_method ?? []).map((m) => m.in_cents));
  const totalOut = sum((d.data?.by_method ?? []).map((m) => m.out_cents));
  return (
    <>
      <PageHead title="Caixa do dia">
        {isOwner && <input type="date" className="input" style={{ width: 'auto' }} value={day} max={today} onChange={(e) => setDay(e.target.value)} aria-label="Data" />}
        {isToday && (!s ? <button className="btn btn-primary" onClick={() => setDlg('open')}>Abrir caixa</button>
          : !s.closed_at ? <><button className="btn" onClick={() => setDlg('entry')}>Sangria / suprimento</button><Link className="btn" to="/app/venda-rapida">Venda rápida</Link>
            <button className="btn btn-primary" onClick={() => setDlg('close')}>Fechar caixa</button></>
          : isOwner && <button className="btn" onClick={async () => done(await cmd.run('POST', '/api/v1/cash/reopen', {}, { success: 'Caixa reaberto.' }))}>Reabrir</button>)}
      </PageHead>
      {d.loading ? <Loading /> : !s ? <Empty title={isToday ? 'Caixa ainda não aberto hoje. A primeira venda abre automaticamente com troco zero.' : 'Sem caixa neste dia.'} /> : (<>
        <div className="stats">
          <div className="stat"><div className="k">Entradas</div><div className="v money">{formatCents(totalIn.toString())}</div></div>
          <div className="stat"><div className="k">Saídas</div><div className="v money">{formatCents(totalOut.toString())}</div></div>
          <div className="stat"><div className="k">Troco inicial</div><div className="v money">{formatCents(s.opening_cents)}</div><div className="subtle">{s.opened_by}</div></div>
          <div className="stat"><div className="k">Dinheiro na gaveta</div><div className="v money">{formatCents(s.closed_at ? s.expected_cash_cents : d.data!.expected_cash_now_cents)}</div><div className="subtle">esperado</div></div>
          {s.closed_at && <div className="stat"><div className="k">Fechamento</div><div className="v money">{formatCents(s.counted_cents)}</div>
            <div className="subtle">{(() => { const diff = BigInt(s.counted_cents ?? '0') - BigInt(s.expected_cash_cents ?? '0'); return diff === 0n ? 'Bateu ✔' : `${diff > 0n ? 'Sobra' : 'Falta'} ${formatCents((diff < 0n ? -diff : diff).toString())}`; })()} · {s.closed_by}</div></div>}
        </div>
        <section className="card">
          <div className="card-head"><h2>Por forma de pagamento</h2></div>
          {!d.data!.by_method.length ? <Empty title="Nenhum lançamento." /> : (
            <div className="table-wrap" style={{ border: 0 }}><table className="table"><thead><tr><th>Forma</th><th className="num">Entradas</th><th className="num">Saídas</th><th className="num">Saldo</th></tr></thead>
              <tbody>{d.data!.by_method.map((m) => <tr key={m.method}><td>{METHODS[m.method] ?? m.method}</td><td className="num">{formatCents(m.in_cents)}</td><td className="num">{formatCents(m.out_cents)}</td>
                <td className="num"><strong>{formatCents((BigInt(m.in_cents) - BigInt(m.out_cents)).toString())}</strong></td></tr>)}</tbody></table></div>)}
        </section>
        <section className="card">
          <div className="card-head"><h2>Lançamentos</h2></div>
          {!d.data!.entries.length ? <Empty title="Nenhum lançamento." /> : (
            <div className="table-wrap" style={{ border: 0 }}><table className="table"><thead><tr><th>Hora</th><th>Tipo</th><th>Descrição</th><th>Forma</th><th className="num">Valor</th><th>Por</th><th /></tr></thead>
              <tbody>{d.data!.entries.map((e) => (
                <tr key={e.id} style={e.reversed_at ? { opacity: 0.5, textDecoration: 'line-through' } : undefined}>
                  <td>{formatInstant(e.created_at).split(', ')[1] ?? formatInstant(e.created_at)}</td><td>{KINDS[e.kind] ?? e.kind}</td>
                  <td>{e.order_id ? <Link to={`/app/vendas/${e.order_id}`}>{e.description}</Link> : e.description}{e.reversed_reason && <div className="subtle">estornado: {e.reversed_reason}</div>}</td>
                  <td>{METHODS[e.method]}{e.installments && e.installments > 1 ? ` ${e.installments}x` : ''}</td>
                  <td className="num" style={{ color: e.direction === 'OUT' ? 'var(--danger, #e5484d)' : undefined }}>{e.direction === 'OUT' ? '−' : ''}{formatCents(e.amount_cents)}</td>
                  <td>{e.by}</td>
                  <td>{isToday && !s.closed_at && !e.reversed_at && <button className="btn btn-ghost btn-sm" onClick={async () => {
                    const reason = window.prompt('Motivo do estorno'); if (!reason) return;
                    await done(await cmd.run('POST', `/api/v1/cash/entries/${e.id}/reversal`, { reason }, { success: 'Lançamento estornado.' }));
                  }}>Estornar</button>}</td></tr>))}</tbody></table></div>)}
        </section>
      </>)}
      <Dialog open={dlg === 'open'} title="Abrir caixa" onClose={() => setDlg(null)} footer={<><button className="btn" onClick={() => setDlg(null)}>Cancelar</button>
        <button className="btn btn-primary" disabled={cmd.busy} onClick={async () => done(await cmd.run('POST', '/api/v1/cash/open', { opening_cents: toCents(f.amount) }, { success: 'Caixa aberto.' }))}>Abrir</button></>}>
        <Field label="Troco inicial na gaveta (R$)">{(p) => <input {...p} className="input" inputMode="decimal" autoFocus value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} placeholder="200,00" />}</Field>
      </Dialog>
      <Dialog open={dlg === 'entry'} title="Lançamento no caixa" onClose={() => setDlg(null)} footer={<><button className="btn" onClick={() => setDlg(null)}>Cancelar</button>
        <button className="btn btn-primary" disabled={cmd.busy || !f.description} onClick={async () => done(await cmd.run('POST', '/api/v1/cash/entries',
          { direction: f.kind === 'SUPPLY' ? 'IN' : f.kind === 'OTHER' ? f.direction : 'OUT', kind: f.kind, method: f.method, amount_cents: toCents(f.amount), description: f.description }, { success: 'Lançado.' }))}>Lançar</button></>}>
        <div className="form-grid">
          <Field label="Tipo">{(p) => <select {...p} className="input" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
            <option value="WITHDRAWAL">Sangria (retirada)</option><option value="SUPPLY">Suprimento (reforço de troco)</option><option value="EXPENSE">Despesa paga no caixa</option><option value="OTHER">Outro</option></select>}</Field>
          {f.kind === 'OTHER' && <Field label="Entrada ou saída">{(p) => <select {...p} className="input" value={f.direction} onChange={(e) => setF({ ...f, direction: e.target.value })}><option value="IN">Entrada</option><option value="OUT">Saída</option></select>}</Field>}
          <Field label="Forma">{(p) => <select {...p} className="input" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>
            {['CASH', 'PIX', 'DEBIT', 'CREDIT', 'TRANSFER', 'OTHER'].map((m) => <option key={m} value={m}>{METHODS[m]}</option>)}</select>}</Field>
          <Field label="Valor (R$)">{(p) => <input {...p} className="input" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />}</Field>
          <Field label="Descrição">{(p) => <input {...p} className="input" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Ex.: depósito no banco, café, motoboy" />}</Field>
        </div>
      </Dialog>
      <Dialog open={dlg === 'close'} title="Fechar caixa" onClose={() => setDlg(null)} footer={<><button className="btn" onClick={() => setDlg(null)}>Cancelar</button>
        <button className="btn btn-primary" disabled={cmd.busy || !f.amount} onClick={async () => done(await cmd.run('POST', '/api/v1/cash/close', { counted_cents: toCents(f.amount), ...(f.note ? { note: f.note } : {}) }, { success: 'Caixa fechado.' }))}>Fechar</button></>}>
        <p style={{ marginBottom: 12 }}>Conte o dinheiro da gaveta. Esperado: <strong>{formatCents(d.data?.expected_cash_now_cents)}</strong></p>
        <Field label="Dinheiro contado (R$)">{(p) => <input {...p} className="input" inputMode="decimal" autoFocus value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />}</Field>
        <Field label="Observação" optional>{(p) => <input {...p} className="input" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />}</Field>
      </Dialog>
      {cmd.error != null && <div className="alert alert-danger" role="alert">{describeError(cmd.error)}</div>}
    </>
  );
}

/** Recebimentos do pedido (no detalhe da venda). */
export function ReceiptsCard({ orderId, cancelled }: { orderId: string; cancelled: boolean }) {
  const r = useLoad(() => api.get<{ total_cents: string; received_cents: string; entries: Array<{ id: string; method: string; installments: number | null; amount_cents: string; created_at: string; by: string; reversed_at: string | null }> }>(`/api/v1/orders/${orderId}/receipts`), [orderId]);
  const [f, setF] = useState<{ method: string; amount: string; installments: number } | null>(null);
  const cmd = useCommand();
  const open = r.data ? BigInt(r.data.total_cents) - BigInt(r.data.received_cents) : 0n;
  return (
    <section className="card">
      <div className="card-head"><h2>Recebimentos</h2>
        {r.data && (open > 0n ? <Status tone="warn">Falta {formatCents(open.toString())}</Status> : <Status tone="ok">Quitado</Status>)}</div>
      {r.data?.entries.length ? (
        <ul className="timeline">{r.data.entries.map((e) => (
          <li key={e.id} style={e.reversed_at ? { opacity: 0.5, textDecoration: 'line-through' } : undefined}><span className="dot" />
            <div>{formatCents(e.amount_cents)} · {METHODS[e.method]}{e.installments && e.installments > 1 ? ` ${e.installments}x` : ''} <span className="subtle">· {formatInstant(e.created_at)} · {e.by}</span></div></li>))}</ul>
      ) : <p className="subtle">Nada recebido ainda.</p>}
      {!cancelled && open > 0n && (f ? (
        <div className="form-grid" style={{ marginTop: 12 }}>
          <Field label="Forma">{(p) => <select {...p} className="input" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>
            {['PIX', 'CASH', 'DEBIT', 'CREDIT', 'TRANSFER', 'BOLETO'].map((m) => <option key={m} value={m}>{METHODS[m]}</option>)}</select>}</Field>
          <Field label="Valor (R$)">{(p) => <input {...p} className="input" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />}</Field>
          {f.method === 'CREDIT' && <Field label="Parcelas">{(p) => <input {...p} className="input" type="number" min={1} max={24} value={f.installments} onChange={(e) => setF({ ...f, installments: Number(e.target.value) })} />}</Field>}
          <div className="form-actions" style={{ alignSelf: 'end' }}><button className="btn" onClick={() => setF(null)}>Cancelar</button>
            <button className="btn btn-primary" disabled={cmd.busy} onClick={async () => {
              if (await cmd.run('POST', `/api/v1/orders/${orderId}/receipts`, { method: f.method, amount_cents: toCents(f.amount), ...(f.method === 'CREDIT' ? { installments: f.installments } : {}) }, { success: 'Recebimento lançado no caixa.' })) { setF(null); r.reload(); }
            }}>Registrar</button></div>
        </div>
      ) : <button className="btn btn-sm" style={{ marginTop: 12 }} onClick={() => setF({ method: 'PIX', amount: formatCents(open.toString()).replace('R$ ', '').trim(), installments: 1 })}>Registrar recebimento</button>)}
      {cmd.error != null && <div className="alert alert-danger" style={{ marginTop: 12 }}>{describeError(cmd.error)}</div>}
    </section>
  );
}
