import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, describeError, fieldOf } from '../api';
import { PageHead, useCommand } from '../components/Shell';
import { Dialog, Empty, ErrorBox, Field, Icon, Loading, Status, formatDateOnly, formatInstant, formatPhone, useLoad, waLink } from '../components/ui';
import { useSession } from '../session';

export type Contact = {
  id: string; name: string; person_type: 'PF' | 'PJ' | null; trade_name: string | null; mobile_phone: string | null; phone: string | null;
  cpf: string | null; cnpj: string | null; email: string | null; notes: string | null; owner_id: string | null; owner_name: string | null;
  birthday: { day: number; month: number; year: number | null } | null; roles: string[]; version: number; created_at: string;
  migration_pending: boolean;
};
type ContactDetail = Contact & {
  opportunities: Array<{ id: string; title: string; stage_name: string; stage_kind: string; updated_at: string }>;
  activities: Array<{ id: string; kind: string; body: string; due_at: string | null; completed_at: string | null; author_name: string; created_at: string }>;
  possible_duplicates: Array<{ id: string; name: string; matched_on: string[] }>;
};

const maskCpf = (c: string | null) => (c ? `•••.${c.slice(3, 6)}.•••-${c.slice(9)}` : '—');

export function ContactsPage() {
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const nav = useNavigate();
  const list = useLoad(() => api.page<Contact>(`/api/v1/contacts?limit=50${query ? `&q=${encodeURIComponent(query)}` : ''}${cursor ? `&cursor=${cursor}` : ''}`), [query, cursor]);
  return (
    <>
      <PageHead title="Contatos" subtitle="Clientes e leads da sua carteira.">
        <button className="btn btn-primary" onClick={() => setCreating(true)}><Icon name="plus" /> Novo contato</button>
      </PageHead>
      <form className="toolbar" role="search" onSubmit={(e) => { e.preventDefault(); setCursor(null); setQuery(q.trim()); }}>
        <div className="field search"><label htmlFor="q" className="visually-hidden">Buscar</label>
          <input id="q" className="input" placeholder="Buscar por nome, celular, CPF ou e-mail" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <button className="btn"><Icon name="search" /> Buscar</button>
      </form>
      {list.loading ? <Loading /> : list.error ? <ErrorBox error={list.error} onRetry={list.reload} /> : !list.data?.data.length ? (
        <Empty title={query ? 'Nenhum contato encontrado.' : 'Nenhum contato ainda.'}>{!query && <button className="btn btn-primary" onClick={() => setCreating(true)}>Cadastrar o primeiro</button>}</Empty>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Nome</th><th>Celular</th><th>Papéis</th><th>Responsável</th><th>Cadastro</th></tr></thead>
            <tbody>
              {list.data.data.map((c) => (
                <tr key={c.id}>
                  <td><Link className="row-link" to={`/app/contatos/${c.id}`}>{c.name}</Link>{c.migration_pending && <> <Status tone="warn">Migração pendente</Status></>}</td>
                  <td className="mono">{formatPhone(c.mobile_phone)}</td>
                  <td>{c.roles.map((r) => <span key={r} className="chip" style={{ marginRight: 4 }}>{r === 'CUSTOMER' ? 'Cliente' : 'Fornecedor'}</span>)}</td>
                  <td>{c.owner_name ?? '—'}</td>
                  <td className="subtle">{formatInstant(c.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {list.data?.page.has_more && <div><button className="btn" onClick={() => setCursor(list.data!.page.next_cursor)}>Próxima página</button></div>}
      <ContactCreateDialog open={creating} onClose={() => setCreating(false)} onCreated={(id) => nav(`/app/contatos/${id}`)} />
    </>
  );
}

export function ContactCreateDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string, dups: unknown[]) => void }) {
  const [f, setF] = useState({ name: '', mobile_phone: '', cpf: '', email: '', notes: '' });
  const cmd = useCommand();
  const fe = (k: string) => (fieldOf(cmd.error) === k ? describeError(cmd.error) : null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    const body: Record<string, string> = { name: f.name, mobile_phone: f.mobile_phone };
    for (const k of ['cpf', 'email', 'notes'] as const) if (f[k].trim()) body[k] = f[k];
    const r = await cmd.run<{ id: string; possible_duplicates: unknown[] }>('POST', '/api/v1/contacts', body, { success: 'Contato salvo.' });
    if (r) { setF({ name: '', mobile_phone: '', cpf: '', email: '', notes: '' }); onClose(); onCreated(r.id, r.possible_duplicates); }
  }
  return (
    <Dialog open={open} title="Novo contato" onClose={onClose}>
      <form onSubmit={submit} noValidate style={{ display: 'grid', gap: 16 }}>
        <Field label="Nome" error={fe('name')}>{(p) => <input {...p} className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus />}</Field>
        <Field label="Celular" error={fe('mobile_phone')}>{(p) => <input {...p} className="input" type="tel" inputMode="tel" placeholder="(11) 98765-4321" value={f.mobile_phone} onChange={(e) => setF({ ...f, mobile_phone: e.target.value })} />}</Field>
        <details className="more">
          <summary>Mais dados (opcionais)</summary>
          <div style={{ display: 'grid', gap: 16, marginTop: 12 }}>
            <div className="form-grid">
              <Field label="CPF" optional error={fe('cpf')}>{(p) => <input {...p} className="input" inputMode="numeric" value={f.cpf} onChange={(e) => setF({ ...f, cpf: e.target.value })} />}</Field>
              <Field label="E-mail" optional error={fe('email')}>{(p) => <input {...p} className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />}</Field>
            </div>
            <Field label="Observação" optional>{(p) => <textarea {...p} className="input" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />}</Field>
          </div>
        </details>
        <div className="form-actions"><button type="button" className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" disabled={cmd.busy}>{cmd.busy ? 'Salvando…' : 'Salvar contato'}</button></div>
      </form>
    </Dialog>
  );
}

export function ContactDetailPage() {
  const { id } = useParams();
  const { session } = useSession();
  const c = useLoad(() => api.get<ContactDetail>(`/api/v1/contacts/${id}`), [id]);
  const [editing, setEditing] = useState(false);
  const cmd = useCommand();
  const nav = useNavigate();
  if (c.loading) return <Loading rows={5} />;
  if (c.error || !c.data) return <ErrorBox error={c.error ?? 'Não encontrado'} onRetry={c.reload} />;
  const d = c.data;
  async function newOpportunity() {
    const r = await cmd.run<{ id: string }>('POST', '/api/v1/opportunities', { contact_id: d.id }, { success: 'Oportunidade criada em “Novo”.' });
    if (r) nav(`/app/pipeline?abrir=${r.id}`);
  }
  return (
    <>
      <PageHead title={d.name} subtitle={d.roles.map((r) => (r === 'CUSTOMER' ? 'Cliente' : 'Fornecedor')).join(' · ')}>
        {d.mobile_phone && <a className="btn" href={waLink(d.mobile_phone)} target="_blank" rel="noreferrer"><Icon name="phone" /> WhatsApp</a>}
        <button className="btn" onClick={() => setEditing(true)}>Editar</button>
        {d.roles.includes('CUSTOMER') && <button className="btn btn-primary" onClick={newOpportunity} disabled={cmd.busy}>Nova oportunidade</button>}
      </PageHead>
      {d.possible_duplicates.length > 0 && (
        <div className="alert alert-warn"><strong>Possível cadastro repetido</strong>
          Mesmo dado em: {d.possible_duplicates.map((x, i) => <span key={x.id}>{i > 0 && ', '}<Link to={`/app/contatos/${x.id}`}>{x.name}</Link></span>)}.
          Telefone pode ser compartilhado (família); nada foi mesclado automaticamente.</div>
      )}
      <div className="grid-2">
        <section className="card">
          <div className="card-head"><h2>Dados</h2></div>
          <dl className="kv">
            <dt>Celular</dt><dd className="mono">{formatPhone(d.mobile_phone)}</dd>
            <dt>E-mail</dt><dd>{d.email ?? '—'}</dd>
            <dt>Tipo</dt><dd>{d.person_type === 'PF' ? 'Pessoa física' : d.person_type === 'PJ' ? 'Pessoa jurídica' : 'Não informado'}</dd>
            <dt>CPF</dt><dd className="mono">{maskCpf(d.cpf)}</dd>
            {d.cnpj && <><dt>CNPJ</dt><dd className="mono">{d.cnpj}</dd></>}
            <dt>Aniversário</dt><dd>{d.birthday ? `${String(d.birthday.day).padStart(2, '0')}/${String(d.birthday.month).padStart(2, '0')}${d.birthday.year ? `/${d.birthday.year}` : ''}` : '—'}</dd>
            <dt>Responsável</dt><dd>{d.owner_name ?? '—'}</dd>
            <dt>Observação</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{d.notes ?? '—'}</dd>
          </dl>
        </section>
        <section className="card">
          <div className="card-head"><h2>Oportunidades</h2></div>
          {d.opportunities.length === 0 ? <p className="muted">Nenhuma oportunidade.</p> : (
            <ul className="timeline">{d.opportunities.map((o) => (
              <li key={o.id}><span className="dot" /><div><Link to={`/app/pipeline?abrir=${o.id}`}>{o.title}</Link>
                <div className="subtle">{o.stage_name} · atualizado {formatInstant(o.updated_at)}</div></div></li>))}</ul>
          )}
          <div className="card-head" style={{ marginTop: 24 }}><h3>Atividades</h3></div>
          {d.activities.length === 0 ? <p className="muted">Sem atividades registradas.</p> : (
            <ul className="timeline">{d.activities.map((a) => (
              <li key={a.id}><span className="dot" /><div><div style={{ whiteSpace: 'pre-wrap' }}>{a.body}</div>
                <div className="subtle">{KIND[a.kind]} · {a.author_name} · {formatInstant(a.created_at)}{a.due_at ? ` · retorno ${formatInstant(a.due_at)}` : ''}</div></div></li>))}</ul>
          )}
        </section>
      </div>
      <ContactEditDialog open={editing} contact={d} isOwner={session?.profile === 'OWNER'} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); c.reload(); }} />
    </>
  );
}
export const KIND: Record<string, string> = { NOTE: 'Anotação', CALL: 'Contato registrado', TASK: 'Tarefa' };

export function ContactEditDialog({ open, contact, isOwner, onClose, onSaved }: { open: boolean; contact: Contact; isOwner: boolean; onClose: () => void; onSaved: () => void }) {
  const init = () => ({
    name: contact.name, mobile_phone: formatPhone(contact.mobile_phone).replace('—', ''), cpf: contact.cpf ?? '', email: contact.email ?? '',
    notes: contact.notes ?? '', person_type: contact.person_type ?? '', bday: contact.birthday ? `${contact.birthday.day}/${contact.birthday.month}${contact.birthday.year ? `/${contact.birthday.year}` : ''}` : '',
    cnpj: contact.cnpj ?? '', trade_name: contact.trade_name ?? '', phone: contact.phone ?? '',
  });
  const [f, setF] = useState(init);
  const [bErr, setBErr] = useState<string | null>(null);
  const cmd = useCommand();
  const fe = (k: string) => (fieldOf(cmd.error) === k ? describeError(cmd.error) : null);
  const supplier = contact.roles.includes('SUPPLIER');
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBErr(null);
    const body: Record<string, unknown> = { expected_version: contact.version };
    const init0 = init();
    const changed = (k: keyof typeof f) => f[k] !== init0[k];
    if (changed('name')) body.name = f.name;
    if (changed('mobile_phone')) body.mobile_phone = f.mobile_phone.trim() || null;
    for (const k of ['cpf', 'email', 'notes'] as const) if (changed(k)) body[k] = f[k].trim() || null;
    if (changed('person_type')) body.person_type = f.person_type || null;
    if (isOwner) for (const k of ['cnpj', 'trade_name', 'phone'] as const) if (changed(k)) body[k] = f[k].trim() || null;
    if (changed('bday')) {
      if (!f.bday.trim()) body.birthday = null;
      else {
        const m = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/.exec(f.bday.trim());
        if (!m) { setBErr('Use dia/mês ou dia/mês/ano, por exemplo 25/12 ou 25/12/1990.'); return; }
        body.birthday = { day: Number(m[1]), month: Number(m[2]), ...(m[3] ? { year: Number(m[3]) } : {}) };
      }
    }
    if (Object.keys(body).length === 1) { onClose(); return; }
    if (await cmd.run('PATCH', `/api/v1/contacts/${contact.id}`, body, { success: 'Contato atualizado.' })) onSaved();
  }
  return (
    <Dialog open={open} title="Editar contato" onClose={onClose}>
      <form onSubmit={submit} noValidate style={{ display: 'grid', gap: 16 }}>
        {!!cmd.error && fieldOf(cmd.error) === undefined && <div className="alert alert-danger" role="alert">{describeError(cmd.error)}</div>}
        <Field label="Nome" error={fe('name')}>{(p) => <input {...p} className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
        <div className="form-grid">
          <Field label="Celular" optional={supplier && !contact.roles.includes('CUSTOMER')} error={fe('mobile_phone')}>{(p) => <input {...p} className="input" type="tel" value={f.mobile_phone} onChange={(e) => setF({ ...f, mobile_phone: e.target.value })} />}</Field>
          <Field label="E-mail" optional error={fe('email')}>{(p) => <input {...p} className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />}</Field>
          <Field label="Tipo de pessoa" optional help="Aniversariantes listam só Pessoa física confirmada." error={fe('person_type')}>
            {(p) => <select {...p} className="input" value={f.person_type} onChange={(e) => setF({ ...f, person_type: e.target.value })}>
              <option value="">Não informado</option><option value="PF">Pessoa física</option><option value="PJ">Pessoa jurídica</option></select>}
          </Field>
          <Field label="CPF" optional error={fe('cpf')}>{(p) => <input {...p} className="input" inputMode="numeric" value={f.cpf} onChange={(e) => setF({ ...f, cpf: e.target.value })} />}</Field>
          <Field label="Aniversário" optional help="dia/mês, ano se souber" error={bErr ?? fe('birthday')}>{(p) => <input {...p} className="input" placeholder="25/12" value={f.bday} onChange={(e) => setF({ ...f, bday: e.target.value })} />}</Field>
          {isOwner && <>
            <Field label="CNPJ" optional error={fe('cnpj')}>{(p) => <input {...p} className="input" inputMode="numeric" value={f.cnpj} onChange={(e) => setF({ ...f, cnpj: e.target.value })} />}</Field>
            <Field label="Nome fantasia" optional>{(p) => <input {...p} className="input" value={f.trade_name} onChange={(e) => setF({ ...f, trade_name: e.target.value })} />}</Field>
            <Field label="Telefone fixo" optional>{(p) => <input {...p} className="input" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />}</Field>
          </>}
        </div>
        <Field label="Observação" optional>{(p) => <textarea {...p} className="input" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />}</Field>
        <div className="form-actions"><button type="button" className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" disabled={cmd.busy}>Salvar alterações</button></div>
      </form>
    </Dialog>
  );
}

export function SuppliersPage() {
  const list = useLoad(() => api.page<Contact>('/api/v1/suppliers?limit=100'), []);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: '', person_type: 'PJ', cnpj: '', cpf: '', email: '', mobile_phone: '' });
  const cmd = useCommand();
  const fe = (k: string) => (fieldOf(cmd.error) === k ? describeError(cmd.error) : null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    const body: Record<string, string> = { name: f.name, person_type: f.person_type };
    for (const k of ['cnpj', 'cpf', 'email', 'mobile_phone'] as const) if (f[k].trim()) body[k] = f[k];
    if (await cmd.run('POST', '/api/v1/suppliers', body, { success: 'Fornecedor salvo.' })) { setOpen(false); list.reload(); }
  }
  return (
    <>
      <PageHead title="Fornecedores" subtitle="Mesmo cadastro de contatos, com papel de fornecedor. Não habilita pagamentos.">
        <button className="btn btn-primary" onClick={() => setOpen(true)}><Icon name="plus" /> Novo fornecedor</button>
      </PageHead>
      {list.loading ? <Loading /> : list.error ? <ErrorBox error={list.error} onRetry={list.reload} /> : !list.data?.data.length ? <Empty title="Nenhum fornecedor cadastrado." /> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Nome</th><th>Tipo</th><th>Documento</th><th>Contato</th></tr></thead>
          <tbody>{list.data.data.map((s) => (
            <tr key={s.id}><td><Link className="row-link" to={`/app/contatos/${s.id}`}>{s.name}</Link></td><td>{s.person_type}</td>
              <td className="mono">{s.cnpj ?? (s.cpf ? maskCpf(s.cpf) : '—')}</td><td>{s.email ?? formatPhone(s.mobile_phone)}</td></tr>))}</tbody>
        </table></div>
      )}
      <Dialog open={open} title="Novo fornecedor" onClose={() => setOpen(false)}>
        <form onSubmit={submit} noValidate style={{ display: 'grid', gap: 16 }}>
          <Field label="Nome ou razão social" error={fe('name')}>{(p) => <input {...p} className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
          <Field label="Tipo" error={fe('person_type')}>{(p) => <select {...p} className="input" value={f.person_type} onChange={(e) => setF({ ...f, person_type: e.target.value })}><option value="PJ">Pessoa jurídica</option><option value="PF">Pessoa física</option></select>}</Field>
          <div className="form-grid">
            {f.person_type === 'PJ'
              ? <Field label="CNPJ" optional error={fe('cnpj')}>{(p) => <input {...p} className="input" value={f.cnpj} onChange={(e) => setF({ ...f, cnpj: e.target.value })} />}</Field>
              : <Field label="CPF" optional error={fe('cpf')}>{(p) => <input {...p} className="input" value={f.cpf} onChange={(e) => setF({ ...f, cpf: e.target.value })} />}</Field>}
            <Field label="E-mail" optional error={fe('email')}>{(p) => <input {...p} className="input" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />}</Field>
            <Field label="Celular" optional error={fe('mobile_phone')}>{(p) => <input {...p} className="input" value={f.mobile_phone} onChange={(e) => setF({ ...f, mobile_phone: e.target.value })} />}</Field>
          </div>
          <div className="form-actions"><button type="button" className="btn" onClick={() => setOpen(false)}>Cancelar</button><button className="btn btn-primary" disabled={cmd.busy}>Salvar fornecedor</button></div>
        </form>
      </Dialog>
    </>
  );
}

export function BirthdaysPage() {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
  const monthStart = `${today.slice(0, 7)}-01`;
  const nextMonth = (() => { const [y, m] = today.split('-').map(Number); return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`; })();
  const [mode, setMode] = useState<'day' | 'month' | 'range'>('month');
  const [range, setRange] = useState({ from: today, to: addDays(today, 7) });
  const period = mode === 'day' ? { from: today, to: addDays(today, 1) } : mode === 'month' ? { from: monthStart, to: nextMonth } : { from: range.from, to: addDays(range.to, 1) };
  const list = useLoad(() => api.get<{ data: Array<{ contact_id: string; name: string; mobile_phone: string; owner_name: string; occurrence_date: string | null; leap_exception: boolean; day: number; month: number; age: number | null }>; pending_person_type: number }>(
    `/api/v1/contacts/birthdays?from=${period.from}&to=${period.to}`), [period.from, period.to]);
  return (
    <>
      <PageHead title="Aniversariantes" subtitle="Consulta da carteira. Nada é enviado automaticamente nesta etapa." />
      <div className="toolbar">
        <div className="segmented" role="group" aria-label="Período">
          {(['day', 'month', 'range'] as const).map((m) => <button key={m} aria-pressed={mode === m} onClick={() => setMode(m)}>{{ day: 'Hoje', month: 'Este mês', range: 'Intervalo' }[m]}</button>)}
        </div>
        {mode === 'range' && <>
          <Field label="De">{(p) => <input {...p} type="date" className="input" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />}</Field>
          <Field label="Até (inclusive)">{(p) => <input {...p} type="date" className="input" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />}</Field>
        </>}
      </div>
      {list.data && list.data.pending_person_type > 0 && <div className="alert">
        {list.data.pending_person_type} contato(s) com aniversário mas sem “Pessoa física” confirmada ficam fora da lista até o tipo ser informado.</div>}
      {list.loading ? <Loading /> : list.error ? <ErrorBox error={list.error} onRetry={list.reload} /> : !list.data?.data.length ? <Empty title="Nenhum aniversariante no período." /> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Data</th><th>Nome</th><th>Celular</th><th className="num">Idade</th><th>Responsável</th></tr></thead>
          <tbody>{list.data.data.map((b) => (
            <tr key={`${b.contact_id}-${b.occurrence_date}`}>
              <td>{b.leap_exception ? <Status tone="warn">29/02 · ano não bissexto</Status> : formatDateOnly(b.occurrence_date)}</td>
              <td><Link className="row-link" to={`/app/contatos/${b.contact_id}`}>{b.name}</Link></td>
              <td className="mono"><a href={waLink(b.mobile_phone)} target="_blank" rel="noreferrer">{formatPhone(b.mobile_phone)}</a></td>
              <td className="num">{b.age ?? '—'}</td><td>{b.owner_name}</td></tr>))}</tbody>
        </table></div>
      )}
    </>
  );
}
