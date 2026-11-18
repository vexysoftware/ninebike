import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { HttpError, api, describeError, supabase } from '../api';
import { PageHead, useCommand } from '../components/Shell';
import { Dialog, Empty, ErrorBox, Field, Icon, Loading, Status, formatInstant, formatPhone, useLoad } from '../components/ui';
import { useSession } from '../session';
import { MfaPrompt } from './Auth';
import { FiscalSettingsCard } from './Fiscal';

export function HomePage() {
  const { session } = useSession();
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
  const agenda = useLoad(() => api.get<Array<{ id: string; body: string; due_at: string; opportunity_id: string | null; contact_id: string; contact_name: string }>>('/api/v1/activities/agenda'), []);
  const board = useLoad(() => api.get<Array<{ id: string; name: string; kind: string; total: number }>>('/api/v1/pipeline-stages?limit=1'), []);
  const bdays = useLoad(() => api.get<{ data: Array<{ contact_id: string; name: string; mobile_phone: string }> }>(`/api/v1/contacts/birthdays?from=${today}&to=${tomorrow}`), []);
  const now = Date.now();
  return (
    <>
      <PageHead title={`Olá, ${session?.name.split(' ')[0]}`} subtitle={session?.profile === 'OWNER' ? 'Visão da loja inteira.' : 'Sua carteira de clientes.'} />
      <div className="stats">
        {board.loading ? <Loading rows={1} /> : board.data?.map((s) => (
          <Link key={s.id} to="/app/pipeline" className="stat" style={{ textDecoration: 'none', color: 'inherit' }}>
            <div className="k">{s.name}</div><div className="v">{s.total}</div></Link>))}
      </div>
      <div className="grid-2">
        <section className="card">
          <div className="card-head"><h2>Próximos retornos</h2><Link to="/app/pipeline" className="subtle">Pipeline</Link></div>
          {agenda.loading ? <Loading /> : agenda.error ? <ErrorBox error={agenda.error} onRetry={agenda.reload} /> : !agenda.data?.length ? <Empty title="Nenhum retorno agendado." /> : (
            <ul className="timeline">{agenda.data.map((a) => (
              <li key={a.id}><span className="dot" /><div>
                <Link to={a.opportunity_id ? `/app/pipeline?abrir=${a.opportunity_id}` : `/app/contatos/${a.contact_id}`}>{a.contact_name}</Link> — {a.body}
                <div>{Date.parse(a.due_at) < now ? <Status tone="danger">Atrasado · {formatInstant(a.due_at)}</Status> : <span className="subtle">{formatInstant(a.due_at)}</span>}</div>
              </div></li>))}</ul>
          )}
        </section>
        <section className="card">
          <div className="card-head"><h2>Aniversariantes de hoje</h2><Link to="/app/aniversariantes" className="subtle">Ver todos</Link></div>
          {bdays.loading ? <Loading /> : !bdays.data?.data.length ? <Empty title="Nenhum aniversariante hoje." /> : (
            <ul className="timeline">{bdays.data.data.map((b) => (
              <li key={b.contact_id}><span className="dot" /><div><Link to={`/app/contatos/${b.contact_id}`}>{b.name}</Link> <span className="subtle">{formatPhone(b.mobile_phone)}</span></div></li>))}</ul>
          )}
        </section>
      </div>
    </>
  );
}

type Users = { users: Array<{ id: string; name: string; email: string; active: boolean; profile: 'SELLER' | 'OWNER'; version: number }>; invitations: Array<{ id: string; email: string; name: string; profile: string; created_at: string }> };
type StageRow = { id: string; name: string; kind: 'OPEN' | 'WON' | 'LOST'; position: number; version: number; total: number };

export function SettingsPage() {
  const { session } = useSession();
  const users = useLoad(() => api.get<Users>('/api/v1/admin/users'), []);
  const stages = useLoad(() => api.get<StageRow[]>('/api/v1/pipeline-stages?limit=1'), []);
  const settings = useLoad(() => api.get<{ default_lead_owner_id: string | null; version: number }>('/api/v1/crm/settings'), []);
  const [invite, setInvite] = useState(false);
  const [mfaRetry, setMfaRetry] = useState<null | (() => Promise<unknown>)>(null);
  const [newStage, setNewStage] = useState('');
  const cmd = useCommand();

  // Ato sensível: se a API pedir MFA recente, pede o TOTP e repete a mesma intenção (mesma chave).
  async function sensitive(fn: () => Promise<unknown>) {
    const r = await fn();
    if (r === 'MFA') setMfaRetry(() => fn);
  }
  const mfaAware = (method: 'POST' | 'PATCH', path: string, body: unknown, success: string, after: () => void) => async () => {
    let needMfa = false;
    const r = await cmd.run(method, path, body, { success, quiet: true, onError: (e) => { needMfa = e instanceof HttpError && e.code === 'MFA_RECENCY_REQUIRED'; } });
    if (r) { after(); return r; }
    return needMfa ? 'MFA' : null;
  };

  async function moveStage(i: number, dir: -1 | 1) {
    const list = [...(stages.data ?? [])];
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    if (await cmd.run('POST', '/api/v1/pipeline-stages/reorder', { stages: list.map((s) => ({ id: s.id, expected_version: s.version })) }, { success: 'Ordem das etapas salva.' })) stages.reload();
    else stages.reload();
  }
  async function renameStage(s: StageRow) {
    const name = window.prompt('Novo nome da etapa', s.name)?.trim();
    if (name && name !== s.name && (await cmd.run('PATCH', `/api/v1/pipeline-stages/${s.id}`, { expected_version: s.version, name }, { success: 'Etapa renomeada.' }))) stages.reload();
  }
  async function archiveStage(s: StageRow) {
    if (window.confirm(`Arquivar a etapa “${s.name}”? O histórico é preservado.`) && (await cmd.run('POST', `/api/v1/pipeline-stages/${s.id}/archive`, { expected_version: s.version }, { success: 'Etapa arquivada.' }))) stages.reload();
  }
  async function addStage(e: FormEvent) {
    e.preventDefault();
    const pos = Math.max(0, (stages.data ?? []).filter((s) => s.kind === 'OPEN').length);
    if (newStage.trim() && (await cmd.run('POST', '/api/v1/pipeline-stages', { name: newStage.trim(), position: pos, kind: 'OPEN' }, { success: 'Etapa criada.' }))) { setNewStage(''); stages.reload(); }
  }

  return (
    <>
      <PageHead title="Configurações" subtitle="Equipe, pipeline e captura de leads." />
      <section className="card">
        <div className="card-head"><h2>Equipe</h2><button className="btn btn-primary" onClick={() => setInvite(true)}><Icon name="plus" /> Convidar pessoa</button></div>
        {users.loading ? <Loading /> : users.error ? <ErrorBox error={users.error} onRetry={users.reload} /> : (
          <div className="table-wrap" style={{ border: 0 }}><table className="table">
            <thead><tr><th>Nome</th><th>E-mail</th><th>Perfil</th><th>Situação</th><th /></tr></thead>
            <tbody>
              {users.data!.users.map((u) => (
                <tr key={u.id}>
                  <td>{u.name}{u.id === session?.user_id && <span className="subtle"> (você)</span>}</td><td>{u.email}</td>
                  <td>{u.profile === 'OWNER' ? 'Proprietário' : 'Vendedor'}</td>
                  <td>{u.active ? <Status tone="ok">Ativo</Status> : <Status tone="neutral">Desativado</Status>}</td>
                  <td><div className="unit-row">
                    <button className="btn btn-sm" onClick={() => void sensitive(mfaAware('PATCH', `/api/v1/admin/users/${u.id}/access`, { expected_version: u.version, profile: u.profile === 'OWNER' ? 'SELLER' : 'OWNER' }, 'Perfil alterado.', users.reload))}>
                      Tornar {u.profile === 'OWNER' ? 'vendedor' : 'proprietário'}</button>
                    <button className="btn btn-sm" onClick={() => void sensitive(mfaAware('PATCH', `/api/v1/admin/users/${u.id}/access`, { expected_version: u.version, active: !u.active }, u.active ? 'Acesso desativado.' : 'Acesso reativado.', users.reload))}>
                      {u.active ? 'Desativar' : 'Reativar'}</button>
                  </div></td>
                </tr>))}
              {users.data!.invitations.map((i) => (
                <tr key={i.id}><td>{i.name}</td><td>{i.email}</td><td>{i.profile === 'OWNER' ? 'Proprietário' : 'Vendedor'}</td><td><Status tone="warn">Convite pendente</Status></td><td /></tr>))}
            </tbody>
          </table></div>
        )}
      </section>

      <div className="grid-2">
        <section className="card">
          <div className="card-head"><h2>Etapas do pipeline</h2></div>
          {stages.loading ? <Loading /> : (
            <ol style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
              {stages.data?.map((s, i) => (
                <li key={s.id} className="unit-row" style={{ borderBottom: '1px solid var(--line)', paddingBottom: 8 }}>
                  <span style={{ flex: 1 }}>{s.name} <span className="subtle">· {s.kind === 'OPEN' ? 'Em aberto' : s.kind === 'WON' ? 'Ganho' : 'Perdido'} · {s.total}</span></span>
                  <button className="btn btn-ghost btn-sm icon-btn" aria-label={`Subir ${s.name}`} disabled={i === 0 || cmd.busy} onClick={() => void moveStage(i, -1)}><Icon name="arrowUp" /></button>
                  <button className="btn btn-ghost btn-sm icon-btn" aria-label={`Descer ${s.name}`} disabled={i === stages.data!.length - 1 || cmd.busy} onClick={() => void moveStage(i, 1)}><Icon name="arrowDown" /></button>
                  <button className="btn btn-sm" onClick={() => void renameStage(s)}>Renomear</button>
                  <button className="btn btn-sm" disabled={s.total > 0} title={s.total > 0 ? 'Mova as oportunidades antes' : undefined} onClick={() => void archiveStage(s)}>Arquivar</button>
                </li>))}
            </ol>
          )}
          <form onSubmit={addStage} className="toolbar" style={{ marginTop: 16 }}>
            <div className="field search"><label htmlFor="ns">Nova etapa em aberto</label><input id="ns" className="input" value={newStage} onChange={(e) => setNewStage(e.target.value)} /></div>
            <button className="btn">Adicionar</button>
          </form>
        </section>
        <section className="card">
          <div className="card-head"><h2>Leads do site</h2></div>
          <p className="muted" style={{ marginBottom: 12 }}>Quem recebe os contatos enviados pelo formulário público. Sem responsável, o formulário fica indisponível.</p>
          {settings.data && users.data && (
            <Field label="Responsável pelos novos leads">{(p) => (
              <select {...p} className="input" value={settings.data!.default_lead_owner_id ?? ''} onChange={async (e) => {
                if (await cmd.run('PATCH', '/api/v1/crm/settings', { expected_version: settings.data!.version, default_lead_owner_id: e.target.value || null }, { success: 'Responsável salvo.' })) settings.reload();
              }}>
                <option value="">Ninguém (formulário desligado)</option>
                {users.data!.users.filter((u) => u.active).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>)}</Field>
          )}
          <p className="subtle" style={{ marginTop: 12 }}>Página pública: <a href="/" target="_blank" rel="noreferrer">{window.location.origin}/</a></p>
        </section>
      </div>
      <PolicyCard />
      <FiscalSettingsCard />
      {supabase && <MfaEnrollCard />}
      <InviteDialog open={invite} onClose={() => setInvite(false)} onDone={() => { setInvite(false); users.reload(); }} sensitive={sensitive} />
      <MfaPrompt open={!!mfaRetry} onCancel={() => setMfaRetry(null)} onDone={async () => { const fn = mfaRetry!; setMfaRetry(null); await sensitive(fn); }} />
      {cmd.error instanceof HttpError && cmd.error.code !== 'MFA_RECENCY_REQUIRED' && <div className="alert alert-danger" role="alert">{describeError(cmd.error)}</div>}
    </>
  );
}

function InviteDialog({ open, onClose, onDone, sensitive }: { open: boolean; onClose: () => void; onDone: () => void; sensitive: (fn: () => Promise<unknown>) => Promise<void> }) {
  const [f, setF] = useState({ name: '', email: '', profile: 'SELLER' });
  const cmd = useCommand();
  return (
    <Dialog open={open} title="Convidar pessoa" onClose={onClose}>
      <form noValidate style={{ display: 'grid', gap: 16 }} onSubmit={(e) => {
        e.preventDefault();
        void sensitive(async () => {
          let mfa = false;
          const r = await cmd.run('POST', '/api/v1/admin/invitations', f, { success: 'Convite enviado por e-mail.', onError: (er) => { mfa = er instanceof HttpError && er.code === 'MFA_RECENCY_REQUIRED'; } });
          if (r) { setF({ name: '', email: '', profile: 'SELLER' }); onDone(); }
          return mfa ? 'MFA' : r;
        });
      }}>
        <p className="muted">Cada pessoa tem login próprio. O perfil define o que ela vê e faz; vendedores não acessam financeiro, custos nem administração.</p>
        <Field label="Nome">{(p) => <input {...p} className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
        <Field label="E-mail">{(p) => <input {...p} className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />}</Field>
        <Field label="Perfil">{(p) => <select {...p} className="input" value={f.profile} onChange={(e) => setF({ ...f, profile: e.target.value })}><option value="SELLER">Vendedor</option><option value="OWNER">Proprietário</option></select>}</Field>
        <div className="form-actions"><button type="button" className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" disabled={cmd.busy}>Enviar convite</button></div>
      </form>
    </Dialog>
  );
}

function MfaEnrollCard() {
  const [qr, setQr] = useState<{ id: string; svg: string; secret: string } | null>(null);
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const factors = useLoad(async () => (await supabase!.auth.mfa.listFactors()).data?.totp ?? [], []);
  const verified = factors.data?.some((f) => f.status === 'verified');
  return (
    <section className="card">
      <div className="card-head"><h2>Segundo fator (TOTP)</h2>{verified && <Status tone="ok">Ativo</Status>}</div>
      <p className="muted">Proprietários precisam do aplicativo autenticador para convites, troca de perfil e, futuramente, atos financeiros.</p>
      {!verified && !qr && <button className="btn" style={{ marginTop: 12 }} onClick={async () => {
        const { data, error } = await supabase!.auth.mfa.enroll({ factorType: 'totp' });
        if (error || !data) return setMsg('Não foi possível iniciar o cadastro.');
        setQr({ id: data.id, svg: data.totp.qr_code, secret: data.totp.secret });
      }}>Ativar segundo fator</button>}
      {qr && <div style={{ display: 'grid', gap: 12, marginTop: 12, maxWidth: 320 }}>
        <img src={qr.svg} alt="QR code para o aplicativo autenticador" width={200} height={200} style={{ background: '#fff', borderRadius: 8 }} />
        <span className="mono subtle">{qr.secret}</span>
        <Field label="Código gerado">{(p) => <input {...p} className="input" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />}</Field>
        <button className="btn btn-primary" onClick={async () => {
          const { error } = await supabase!.auth.mfa.challengeAndVerify({ factorId: qr.id, code });
          if (error) return setMsg('Código inválido.');
          setQr(null); setMsg('Segundo fator ativado.'); factors.reload();
        }}>Confirmar</button>
      </div>}
      {msg && <p style={{ marginTop: 8 }}>{msg}</p>}
    </section>
  );
}

function PolicyCard() {
  const pol = useLoad(() => api.get<{ revision: number; reservation_minutes: number; quote_validity_minutes: number; seller_max_discount_bps: number } | null>('/api/v1/commercial-policy'), []);
  const [f, setF] = useState({ resH: '', valD: '', disc: '' });
  const cmd = useCommand();
  const p = pol.data;
  return (
    <section className="card">
      <div className="card-head"><h2>Política comercial</h2>{p ? <Status tone="ok">Revisão {p.revision}</Status> : <Status tone="warn">Não configurada</Status>}</div>
      <p className="muted" style={{ marginBottom: 12 }}>Sem política, não há reserva nem proposta. Cada alteração cria uma nova revisão; propostas antigas mantêm a regra da época.</p>
      {p && <p style={{ marginBottom: 12 }}>Reserva {p.reservation_minutes / 60} h · validade da proposta {p.quote_validity_minutes / 1440} dia(s) · desconto da vendedora até {p.seller_max_discount_bps / 100}%</p>}
      <form className="form-grid" onSubmit={async (e) => {
        e.preventDefault();
        const body = { expected_revision: p?.revision ?? 0, reservation_minutes: Math.round(Number(f.resH.replace(',', '.')) * 60),
          quote_validity_minutes: Math.round(Number(f.valD.replace(',', '.')) * 1440), seller_max_discount_bps: Math.round(Number(f.disc.replace(',', '.')) * 100) };
        if (await cmd.run('POST', '/api/v1/admin/policy-versions', body, { success: 'Política salva.' })) pol.reload();
      }}>
        <Field label="Prazo da reserva (horas)">{(x) => <input {...x} className="input" inputMode="decimal" value={f.resH} onChange={(e) => setF({ ...f, resH: e.target.value })} placeholder="48" />}</Field>
        <Field label="Validade da proposta (dias)">{(x) => <input {...x} className="input" inputMode="decimal" value={f.valD} onChange={(e) => setF({ ...f, valD: e.target.value })} placeholder="7" />}</Field>
        <Field label="Desconto máximo da vendedora (%)">{(x) => <input {...x} className="input" inputMode="decimal" value={f.disc} onChange={(e) => setF({ ...f, disc: e.target.value })} placeholder="5" />}</Field>
        <div className="form-actions" style={{ alignSelf: 'end' }}><button className="btn btn-primary" disabled={cmd.busy}>Salvar nova revisão</button></div>
      </form>
      {cmd.error != null && <div className="alert alert-danger" style={{ marginTop: 12 }}>{describeError(cmd.error)}</div>}
    </section>
  );
}
