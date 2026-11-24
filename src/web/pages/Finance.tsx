// T10 (parte interna): contas a pagar e resultado gerencial do mês. Somente proprietário.
import { Fragment, useState, type FormEvent } from 'react';
import { api, describeError } from '../api';
import { PageHead, useCommand } from '../components/Shell';
import { Dialog, Empty, ErrorBox, Field, Loading, Status, formatCents, formatDateOnly, parseMoneyInput, useLoad } from '../components/ui';

type Payment = { id: string; amount_cents: string; paid_on: string; method: string; note: string | null; reversed_at: string | null; reversed_reason: string | null };
type Expense = { id: string; description: string; category_name: string; supplier_name: string | null; amount_cents: string; paid_cents: string; open_cents: string;
  competence_month: string; due_date: string; note: string | null; state: string; payment_state: 'OPEN' | 'PARTIAL' | 'PAID' | 'CANCELLED'; overdue: boolean; version: number; payments: Payment[] };
type Category = { id: string; name: string; kind: string };
type Result = { month: string; orders: number; revenue_cents: string; freight_cents: string; cogs_cents: string; cogs_unknown_items: number; gross_profit_cents: string;
  staff_commission_cents: string; taxes_cents: string; operating_expenses_cents: string; financial_expenses_cents: string; result_cents: string;
  non_result_cents: string; expenses_paid_in_month_cents: string; by_category: Array<{ category: string; kind: string; amount_cents: string }>;
  completeness: string; warnings: string[] };

const todaySP = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const PSTATE = { OPEN: ['warn', 'Em aberto'], PARTIAL: ['info', 'Parcial'], PAID: ['ok', 'Paga'], CANCELLED: ['neutral', 'Cancelada'] } as const;
const METHODS = [['PIX', 'Pix'], ['BOLETO', 'Boleto'], ['CARD', 'Cartão'], ['CASH', 'Dinheiro'], ['TRANSFER', 'Transferência'], ['OTHER', 'Outro']];
const WARN: Record<string, string> = {
  cost_unknown_for_some_items: 'Há itens vendidos sem custo cadastrado: o CMV e o resultado estão parciais.',
  no_tax_recorded: 'Nenhum imposto lançado neste mês. Lance o DAS/impostos como despesa para o resultado refletir a realidade.',
  payment_provider_fees_not_integrated: 'Taxas de cartão/maquininha só entram se lançadas como despesa (integração com o meio de pagamento pendente).',
};

export function FinancePage() {
  const [tab, setTab] = useState<'ap' | 'result'>('ap');
  return (
    <>
      <PageHead title="Financeiro" subtitle="Contas a pagar e resultado gerencial da loja." />
      <div className="toolbar" role="tablist" style={{ marginBottom: 16 }}>
        <button role="tab" aria-selected={tab === 'ap'} className={`btn ${tab === 'ap' ? 'btn-primary' : ''}`} onClick={() => setTab('ap')}>Contas a pagar</button>
        <button role="tab" aria-selected={tab === 'result'} className={`btn ${tab === 'result' ? 'btn-primary' : ''}`} onClick={() => setTab('result')}>Resultado do mês</button>
      </div>
      {tab === 'ap' ? <Payables /> : <ResultView />}
    </>
  );
}

function Payables() {
  const [status, setStatus] = useState('OPEN');
  const list = useLoad(() => api.get<Expense[]>(`/api/v1/expenses${status ? `?status=${status}` : ''}`), [status]);
  const cats = useLoad(() => api.get<Category[]>('/api/v1/expense-categories'), []);
  const [creating, setCreating] = useState(false);
  const [paying, setPaying] = useState<Expense | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const cmd = useCommand();
  const total = (list.data ?? []).reduce((s, e) => s + BigInt(e.open_cents), 0n);
  return (
    <>
      <div className="toolbar" style={{ marginBottom: 16 }}>
        <Field label="Mostrar">{(p) => (
          <select {...p} className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="OPEN">A pagar</option><option value="OVERDUE">Vencidas</option><option value="PAID">Pagas</option><option value="">Todas</option>
          </select>)}</Field>
        <div className="grow" />
        <button className="btn btn-primary" style={{ alignSelf: 'end' }} onClick={() => setCreating(true)}>Nova despesa</button>
      </div>
      {list.loading ? <Loading /> : list.error ? <ErrorBox error={list.error} onRetry={list.reload} /> : !list.data!.length ? <Empty title="Nenhuma conta nesta lista." /> : (
        <section className="card">
          {status !== 'PAID' && <p style={{ marginBottom: 12 }}>Em aberto nesta lista: <strong>{formatCents(total.toString())}</strong></p>}
          <div className="table-wrap" style={{ border: 0 }}><table className="table">
            <thead><tr><th>Vencimento</th><th>Descrição</th><th>Categoria</th><th className="num">Valor</th><th className="num">Em aberto</th><th>Situação</th><th /></tr></thead>
            <tbody>{list.data!.map((e) => (<Fragment key={e.id}>
              <tr>
                <td>{formatDateOnly(e.due_date)}</td>
                <td><button className="btn btn-ghost btn-sm" style={{ padding: 0 }} onClick={() => setOpen(open === e.id ? null : e.id)}>{e.description}</button>
                  {e.supplier_name && <div className="subtle">{e.supplier_name}</div>}</td>
                <td>{e.category_name}<div className="subtle">comp. {e.competence_month.slice(5, 7)}/{e.competence_month.slice(0, 4)}</div></td>
                <td className="num">{formatCents(e.amount_cents)}</td><td className="num">{formatCents(e.open_cents)}</td>
                <td>{e.overdue ? <Status tone="danger">Vencida</Status> : <Status tone={PSTATE[e.payment_state][0]}>{PSTATE[e.payment_state][1]}</Status>}</td>
                <td><div className="unit-row">
                  {e.state === 'OPEN' && e.payment_state !== 'PAID' && <button className="btn btn-sm" onClick={() => setPaying(e)}>Dar baixa</button>}
                  {e.state === 'OPEN' && e.paid_cents === '0' && <button className="btn btn-sm" onClick={async () => {
                    const reason = window.prompt('Motivo do cancelamento'); if (!reason) return;
                    if (await cmd.run('POST', `/api/v1/expenses/${e.id}/cancellations`, { expected_version: e.version, reason }, { success: 'Despesa cancelada.' })) list.reload();
                  }}>Cancelar</button>}
                </div></td>
              </tr>
              {open === e.id && (
                <tr><td colSpan={7}>
                  {e.note && <p className="muted">{e.note}</p>}
                  {!e.payments.length ? <span className="subtle">Sem baixas.</span> : (
                    <ul className="timeline">{e.payments.map((p) => (
                      <li key={p.id}><span className="dot" /><div>{formatDateOnly(p.paid_on)} · {formatCents(p.amount_cents)} · {METHODS.find((m) => m[0] === p.method)?.[1]}
                        {p.note && <span className="subtle"> · {p.note}</span>}
                        {p.reversed_at ? <> <Status tone="neutral">Estornada</Status> <span className="subtle">{p.reversed_reason}</span></> : (
                          <button className="btn btn-ghost btn-sm" onClick={async () => {
                            const reason = window.prompt('Motivo do estorno da baixa'); if (!reason) return;
                            if (await cmd.run('POST', `/api/v1/expense-payments/${p.id}/reversals`, { reason }, { success: 'Baixa estornada.' })) list.reload();
                          }}>Estornar</button>)}
                      </div></li>))}</ul>)}
                </td></tr>)}
            </Fragment>))}</tbody>
          </table></div>
        </section>)}
      {creating && cats.data && <ExpenseDialog cats={cats.data} onClose={() => setCreating(false)} onDone={() => { setCreating(false); list.reload(); }} />}
      {paying && <PayDialog e={paying} onClose={() => setPaying(null)} onDone={() => { setPaying(null); list.reload(); }} />}
      {cmd.error != null && <div className="alert alert-danger" role="alert">{describeError(cmd.error)}</div>}
    </>
  );
}

function ExpenseDialog({ cats, onClose, onDone }: { cats: Category[]; onClose: () => void; onDone: () => void }) {
  const t = todaySP();
  const [f, setF] = useState({ description: '', category_id: cats[0]?.id ?? '', amount: '', competence: t.slice(0, 7), due: t, installments: '1', note: '' });
  const [err, setErr] = useState<string | null>(null);
  const cmd = useCommand();
  async function submit(e: FormEvent) {
    e.preventDefault();
    const amount = parseMoneyInput(f.amount);
    if (!amount || amount === '0') { setErr('Informe o valor.'); return; }
    const body = { description: f.description, category_id: f.category_id, amount_cents: amount, competence_month: `${f.competence}-01`, due_date: f.due,
      installments: Number(f.installments) || 1, ...(f.note.trim() ? { note: f.note } : {}) };
    if (await cmd.run('POST', '/api/v1/expenses', body, { success: 'Despesa lançada.' })) onDone();
  }
  return (
    <Dialog open title="Nova despesa" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" form="exp" disabled={cmd.busy}>Lançar</button></>}>
      <form id="exp" className="form-grid" onSubmit={submit}>
        <Field label="Descrição">{(p) => <input {...p} className="input" required value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Aluguel da loja" />}</Field>
        <Field label="Categoria">{(p) => <select {...p} className="input" value={f.category_id} onChange={(e) => setF({ ...f, category_id: e.target.value })}>
          {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>}</Field>
        <Field label="Valor total (R$)" error={err ?? undefined}>{(p) => <input {...p} className="input" inputMode="decimal" required value={f.amount} onChange={(e) => { setErr(null); setF({ ...f, amount: e.target.value }); }} placeholder="3.500,00" />}</Field>
        <Field label="Parcelas" help="Mensais, a partir do 1º vencimento">{(p) => <input {...p} className="input" type="number" min={1} max={48} value={f.installments} onChange={(e) => setF({ ...f, installments: e.target.value })} />}</Field>
        <Field label="Competência (mês do resultado)">{(p) => <input {...p} className="input" type="month" required value={f.competence} onChange={(e) => setF({ ...f, competence: e.target.value })} />}</Field>
        <Field label="Vencimento">{(p) => <input {...p} className="input" type="date" required value={f.due} onChange={(e) => setF({ ...f, due: e.target.value })} />}</Field>
        <Field label="Observação" optional>{(p) => <input {...p} className="input" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />}</Field>
      </form>
    </Dialog>
  );
}

function PayDialog({ e, onClose, onDone }: { e: Expense; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ amount: formatCents(e.open_cents).replace('R$ ', '').trim(), paid_on: todaySP(), method: 'PIX', note: '' });
  const cmd = useCommand();
  return (
    <Dialog open title={`Dar baixa: ${e.description}`} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" form="pay" disabled={cmd.busy}>Confirmar baixa</button></>}>
      <p className="muted" style={{ marginBottom: 12 }}>Em aberto: {formatCents(e.open_cents)}. Pode ser parcial.</p>
      <form id="pay" className="form-grid" onSubmit={async (x) => {
        x.preventDefault();
        const amount = parseMoneyInput(f.amount); if (!amount) return;
        if (await cmd.run('POST', `/api/v1/expenses/${e.id}/payments`, { expected_version: e.version, amount_cents: amount, paid_on: f.paid_on, method: f.method, ...(f.note ? { note: f.note } : {}) }, { success: 'Baixa registrada.' })) onDone();
      }}>
        <Field label="Valor pago (R$)">{(p) => <input {...p} className="input" inputMode="decimal" value={f.amount} onChange={(x) => setF({ ...f, amount: x.target.value })} />}</Field>
        <Field label="Data do pagamento">{(p) => <input {...p} className="input" type="date" value={f.paid_on} onChange={(x) => setF({ ...f, paid_on: x.target.value })} />}</Field>
        <Field label="Forma">{(p) => <select {...p} className="input" value={f.method} onChange={(x) => setF({ ...f, method: x.target.value })}>{METHODS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>}</Field>
        <Field label="Observação" optional>{(p) => <input {...p} className="input" value={f.note} onChange={(x) => setF({ ...f, note: x.target.value })} />}</Field>
      </form>
    </Dialog>
  );
}

function ResultView() {
  const [month, setMonth] = useState(todaySP().slice(0, 7));
  const r = useLoad(() => api.get<Result>(`/api/v1/reports/management-result?month=${month}-01`), [month]);
  const neg = (c: string) => (c === '0' ? c : `-${c}`);
  const d = r.data;
  const Row = ({ label, v, strong, sub }: { label: string; v: string; strong?: boolean; sub?: string }) => (
    <tr><td style={strong ? { fontWeight: 600 } : undefined}>{label}{sub && <div className="subtle">{sub}</div>}</td>
      <td className="num" style={strong ? { fontWeight: 600 } : undefined}>{formatCents(v)}</td></tr>);
  return (
    <>
      <div className="toolbar" style={{ marginBottom: 16 }}>
        <Field label="Mês">{(p) => <input {...p} className="input" type="month" value={month} onChange={(e) => setMonth(e.target.value)} />}</Field>
      </div>
      {r.loading ? <Loading /> : r.error ? <ErrorBox error={r.error} onRetry={r.reload} /> : d && (
        <div className="grid-2">
          <section className="card">
            <div className="card-head"><h2>Resultado gerencial</h2>{d.completeness === 'PARTIAL' ? <Status tone="warn">Parcial</Status> : <Status tone="ok">Fatos lançados</Status>}</div>
            <div className="table-wrap" style={{ border: 0 }}><table className="table"><tbody>
              <Row label="Receita de vendas (sem frete)" v={d.revenue_cents} sub={`${d.orders} pedido(s) confirmados`} />
              <Row label="(−) Custo das mercadorias vendidas" v={neg(d.cogs_cents)} sub={d.cogs_unknown_items ? `${d.cogs_unknown_items} item(ns) sem custo` : undefined} />
              <Row label="Lucro bruto" v={d.gross_profit_cents} strong />
              <Row label="(−) Comissões da equipe" v={neg(d.staff_commission_cents)} />
              <Row label="(−) Impostos lançados" v={neg(d.taxes_cents)} />
              <Row label="(−) Despesas operacionais" v={neg(d.operating_expenses_cents)} />
              <Row label="(−) Despesas financeiras" v={neg(d.financial_expenses_cents)} />
              <Row label="Resultado do mês" v={d.result_cents} strong />
            </tbody></table></div>
            <p className="subtle" style={{ marginTop: 12 }}>Fora do resultado: {formatCents(d.non_result_cents)} (compra de mercadoria, retirada dos sócios). Pago no mês (caixa): {formatCents(d.expenses_paid_in_month_cents)}.</p>
          </section>
          <section className="card">
            <div className="card-head"><h2>Despesas por categoria</h2></div>
            {!d.by_category.length ? <Empty title="Nenhuma despesa com competência neste mês." /> : (
              <div className="table-wrap" style={{ border: 0 }}><table className="table"><tbody>
                {d.by_category.map((c) => <tr key={c.category}><td>{c.category}</td><td className="num">{formatCents(c.amount_cents)}</td></tr>)}
              </tbody></table></div>)}
            {d.warnings.map((w) => <div key={w} className="alert" style={{ marginTop: 12 }}>{WARN[w] ?? w}</div>)}
          </section>
        </div>)}
    </>
  );
}
