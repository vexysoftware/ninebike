import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { HttpError, api, describeError } from '../api';
import { PageHead, useCommand } from '../components/Shell';
import { Empty, ErrorBox, Field, Loading, Status, formatCents, formatInstant, useLoad } from '../components/ui';
import { useSession } from '../session';
import { MfaPrompt } from './Auth';

type Snapshot = {
  model: string; nature: string; issuer: { legal_name?: string; cnpj?: string; state?: string; tax_regime?: string };
  recipient: { name: string; person_type: 'PF' | 'PJ' | null; cpf: string | null; cnpj: string | null; email: string | null;
    address: { street?: string; number?: string; complement?: string; district?: string; city?: string; state?: string; postal_code?: string } };
  items: Array<{ position: number; description: string; sku: string; ncm: string | null; cfop: string | null; unit: string; quantity: string; unit_price_cents: string; discount_cents: string; total_cents: string; serial_number: string | null }>;
  freight_cents: string; total_cents: string; payment: Array<{ mode: string; principal_cents: string }> | null; additional_info: string | null;
};
type Doc = {
  id: string; order_id: string; order_number: number; origin: string; revision: number; snapshot: Snapshot; snapshot_hash: string;
  validation: { ok: boolean; issues: Array<{ field: string; reason: string }> } | null; review_state: string; approved_by_name: string | null;
  approved_at: string | null; approval_current: boolean; official_status: string; access_key: string | null; number: string | null; series: string | null;
  version: number; transmission: { mode: string; available: boolean; reason: string };
};
const REVIEW: Record<string, [string, 'ok' | 'warn' | 'info' | 'danger' | 'neutral']> = {
  DRAFT: ['Rascunho', 'info'], INVALID: ['Com pendências', 'danger'], READY_FOR_REVIEW: ['Pronta para revisão', 'warn'],
  APPROVED: ['Aprovada internamente', 'ok'], EXTERNAL_EVIDENCE: ['Evidência externa', 'neutral'],
};
const OFFICIAL: Record<string, string> = { NOT_SENT: 'Não enviada', AUTHORIZED: 'Autorizada', CANCELLED: 'Cancelada', UNKNOWN: 'Desconhecido' };
const ISSUE: Record<string, string> = {
  'recipient.name': 'Nome do destinatário', 'recipient.person_type': 'Tipo de pessoa do destinatário', 'recipient.cpf': 'CPF do destinatário',
  'recipient.cnpj': 'CNPJ do destinatário', 'recipient.address': 'Endereço completo do destinatário (NF-e)', totals: 'Totais não batem com o pedido',
  issuer: 'Dados do emitente (Configurações → Fiscal)',
};
const issueLabel = (f: string) => ISSUE[f] ?? f.replace(/^items\[(\d+)\]\.(ncm|cfop)$/, (_, i, k) => `Item ${Number(i) + 1}: ${k.toUpperCase()}`);

export function FiscalListPage() {
  const list = useLoad(() => api.get<Doc[]>('/api/v1/fiscal-documents'), []);
  return (
    <>
      <PageHead title="Notas fiscais" subtitle="Rascunhos preparados a partir das vendas. Nenhuma nota é emitida automaticamente." />
      <TransmissionBanner />
      {list.loading ? <Loading /> : list.error ? <ErrorBox error={list.error} onRetry={list.reload} /> : !list.data?.length ? <Empty title="Nenhuma nota preparada." >Prepare a partir de um pedido no Registro de vendas.</Empty> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Pedido</th><th>Revisão</th><th>Situação interna</th><th>Situação oficial</th><th>Número</th></tr></thead>
          <tbody>{list.data.map((d) => (
            <tr key={d.id}><td><Link className="row-link" to={`/app/notas/${d.id}`}>Pedido #{d.order_number}</Link></td><td>{d.revision}</td>
              <td><Status tone={REVIEW[d.review_state]?.[1] ?? 'neutral'}>{REVIEW[d.review_state]?.[0]}</Status></td>
              <td>{OFFICIAL[d.official_status]}</td><td className="mono">{d.number ? `${d.series ?? ''}/${d.number}` : '—'}</td></tr>))}</tbody>
        </table></div>
      )}
    </>
  );
}

function TransmissionBanner() {
  return <div className="alert alert-warn"><strong>Envio à SEFAZ desligado</strong>Sem provedor fiscal homologado, o Ninebike prepara, confere e aprova — a emissão continua no emissor atual. Depois de emitida lá, registre a chave aqui.</div>;
}

export function FiscalDocumentPage() {
  const { id } = useParams();
  const { session } = useSession();
  const owner = session?.profile === 'OWNER';
  const doc = useLoad(() => api.get<Doc>(`/api/v1/fiscal-documents/${id}`), [id]);
  const cmd = useCommand();
  const [r, setR] = useState<Record<string, string>>({});
  const [items, setItems] = useState<Record<number, { ncm: string; cfop: string }>>({});
  const [info, setInfo] = useState('');
  const [ev, setEv] = useState({ key: '', series: '', number: '', protocol: '' });
  const [mfa, setMfa] = useState(false);
  useEffect(() => {
    const s = doc.data?.snapshot;
    if (!s) return;
    const a = s.recipient.address ?? {};
    setR({ person_type: s.recipient.person_type ?? '', cpf: s.recipient.cpf ?? '', cnpj: s.recipient.cnpj ?? '', street: a.street ?? '', number: a.number ?? '',
      complement: a.complement ?? '', district: a.district ?? '', city: a.city ?? '', state: a.state ?? '', postal_code: a.postal_code ?? '' });
    setItems(Object.fromEntries(s.items.map((i) => [i.position, { ncm: i.ncm ?? '', cfop: i.cfop ?? '' }])));
    setInfo(s.additional_info ?? '');
  }, [doc.data?.version]); // eslint-disable-line react-hooks/exhaustive-deps
  if (doc.loading && !doc.data) return <Loading rows={5} />;
  if (doc.error || !doc.data) return <ErrorBox error={doc.error ?? ''} onRetry={doc.reload} />;
  const d = doc.data;
  const s = d.snapshot;
  const editable = d.official_status === 'NOT_SENT' && d.origin === 'APP_CREATED';
  async function saveDraft() {
    const body = { expected_version: d.version,
      recipient: { ...(r.person_type ? { person_type: r.person_type } : {}), cpf: r.cpf || null, cnpj: r.cnpj || null,
        address: { street: r.street, number: r.number, complement: r.complement, district: r.district, city: r.city, state: r.state, postal_code: r.postal_code } },
      items: Object.entries(items).map(([pos, v]) => ({ position: Number(pos), ncm: v.ncm || null, cfop: v.cfop || null })), additional_info: info || null };
    if (await cmd.run('PATCH', `/api/v1/fiscal-documents/${d.id}/draft`, body, { success: 'Rascunho salvo. Valide novamente.' })) doc.reload();
  }
  async function approve() {
    let needMfa = false;
    const ok = await cmd.run('POST', `/api/v1/fiscal-documents/${d.id}/approvals`, { expected_version: d.version, snapshot_hash: d.snapshot_hash },
      { success: 'Nota aprovada internamente. Emita no emissor atual e registre a chave.', quiet: true, onError: (e) => { needMfa = e instanceof HttpError && e.code === 'MFA_RECENCY_REQUIRED'; } });
    if (ok) doc.reload(); else if (needMfa) setMfa(true);
  }
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setR({ ...r, [k]: e.target.value });
  return (
    <>
      <PageHead title={`Nota do pedido #${d.order_number}`} subtitle={`Revisão ${d.revision} · modelo ${s.model === '55' ? 'NF-e' : 'NFC-e'} · ${s.nature}`}>
        <Status tone={REVIEW[d.review_state]?.[1] ?? 'neutral'}>{REVIEW[d.review_state]?.[0]}</Status>
        <Status tone={d.official_status === 'AUTHORIZED' ? 'ok' : 'neutral'}>{OFFICIAL[d.official_status]}</Status>
        <Link className="btn" to={`/app/vendas/${d.order_id}`}>Pedido</Link>
      </PageHead>
      {d.official_status === 'NOT_SENT' && <TransmissionBanner />}
      {d.validation && !d.validation.ok && <div className="alert alert-danger" role="alert"><strong>Pendências para validar</strong>
        <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{d.validation.issues.map((i, k) => <li key={k}>{issueLabel(i.field)}</li>)}</ul></div>}
      {d.approved_at && <div className={`alert ${d.approval_current ? '' : 'alert-warn'}`}>{d.approval_current
        ? <>Aprovada por <strong>{d.approved_by_name}</strong> em {formatInstant(d.approved_at)} sobre esta revisão.</>
        : <>A aprovação anterior foi invalidada porque o rascunho mudou. Valide e aprove de novo.</>}</div>}

      <section className="card">
        <div className="card-head"><h2>1. Emitente</h2></div>
        {s.issuer?.cnpj ? <p>{s.issuer.legal_name} · CNPJ {s.issuer.cnpj} · {s.issuer.state} · {s.issuer.tax_regime}</p> : <p className="muted">Não configurado. {owner && <Link to="/app/configuracoes">Configurar</Link>}</p>}
      </section>
      <section className="card">
        <div className="card-head"><h2>2. Destinatário</h2></div>
        <p style={{ marginBottom: 12 }}><strong>{s.recipient.name}</strong>{s.recipient.email ? ` · ${s.recipient.email}` : ''}</p>
        <div className="form-grid">
          <Field label="Tipo">{(p) => <select {...p} className="input" value={r.person_type ?? ''} onChange={set('person_type')} disabled={!editable}><option value="">—</option><option value="PF">Pessoa física</option><option value="PJ">Pessoa jurídica</option></select>}</Field>
          {r.person_type !== 'PJ'
            ? <Field label="CPF">{(p) => <input {...p} className="input" value={r.cpf ?? ''} onChange={set('cpf')} disabled={!editable} />}</Field>
            : <Field label="CNPJ">{(p) => <input {...p} className="input" value={r.cnpj ?? ''} onChange={set('cnpj')} disabled={!editable} />}</Field>}
          <Field label="CEP">{(p) => <input {...p} className="input" value={r.postal_code ?? ''} onChange={set('postal_code')} disabled={!editable} />}</Field>
          <Field label="Rua">{(p) => <input {...p} className="input" value={r.street ?? ''} onChange={set('street')} disabled={!editable} />}</Field>
          <Field label="Número">{(p) => <input {...p} className="input" value={r.number ?? ''} onChange={set('number')} disabled={!editable} />}</Field>
          <Field label="Complemento" optional>{(p) => <input {...p} className="input" value={r.complement ?? ''} onChange={set('complement')} disabled={!editable} />}</Field>
          <Field label="Bairro">{(p) => <input {...p} className="input" value={r.district ?? ''} onChange={set('district')} disabled={!editable} />}</Field>
          <Field label="Cidade">{(p) => <input {...p} className="input" value={r.city ?? ''} onChange={set('city')} disabled={!editable} />}</Field>
          <Field label="UF">{(p) => <input {...p} className="input" maxLength={2} value={r.state ?? ''} onChange={set('state')} disabled={!editable} />}</Field>
        </div>
      </section>
      <section className="card">
        <div className="card-head"><h2>3. Itens</h2><span className="subtle">NCM e CFOP vêm do responsável fiscal; o sistema não adivinha.</span></div>
        <div className="table-wrap" style={{ border: 0 }}><table className="table">
          <thead><tr><th>Item</th><th>NCM</th><th>CFOP</th><th className="num">Qtd.</th><th className="num">Total</th></tr></thead>
          <tbody>{s.items.map((i) => (
            <tr key={i.position}><td>{i.description}<div className="subtle">{i.sku}{i.serial_number ? ` · série ${i.serial_number}` : ''}</div></td>
              <td><input aria-label={`NCM do item ${i.position + 1}`} className="input mono" style={{ width: 130 }} value={items[i.position]?.ncm ?? ''} disabled={!editable}
                onChange={(e) => setItems({ ...items, [i.position]: { ...items[i.position], ncm: e.target.value } })} /></td>
              <td><input aria-label={`CFOP do item ${i.position + 1}`} className="input mono" style={{ width: 90 }} value={items[i.position]?.cfop ?? ''} disabled={!editable}
                onChange={(e) => setItems({ ...items, [i.position]: { ...items[i.position], cfop: e.target.value } })} /></td>
              <td className="num">{i.quantity}</td><td className="num">{formatCents(i.total_cents)}</td></tr>))}
            {s.freight_cents !== '0' && <tr><td colSpan={4}>Frete</td><td className="num">{formatCents(s.freight_cents)}</td></tr>}
            <tr><td colSpan={4}><strong>Total da nota</strong></td><td className="num"><strong>{formatCents(s.total_cents)}</strong></td></tr></tbody>
        </table></div>
        <p className="subtle" style={{ marginTop: 8 }}>Tributos: o cálculo depende do perfil fiscal homologado com o contador e não é feito nesta etapa.</p>
      </section>
      <section className="card">
        <div className="card-head"><h2>4. Pagamento e informações</h2></div>
        <p style={{ marginBottom: 12 }}>{s.payment?.map((p) => `${p.mode} ${formatCents(p.principal_cents)}`).join(' · ') ?? '—'}</p>
        <Field label="Informações complementares" optional>{(p) => <textarea {...p} className="input" value={info} onChange={(e) => setInfo(e.target.value)} disabled={!editable} />}</Field>
      </section>

      {editable && (
        <div className="form-actions">
          {cmd.error != null && <div className="alert alert-danger" role="alert" style={{ flex: 1 }}>{describeError(cmd.error)}</div>}
          <button className="btn" disabled={cmd.busy} onClick={() => void saveDraft()}>Salvar rascunho</button>
          {(d.review_state === 'DRAFT' || d.review_state === 'INVALID') && <button className="btn btn-primary" disabled={cmd.busy}
            onClick={async () => { if (await cmd.run('POST', `/api/v1/fiscal-documents/${d.id}/validations`, { expected_version: d.version })) doc.reload(); }}>Validar</button>}
          {owner && d.review_state === 'READY_FOR_REVIEW' && <button className="btn btn-primary" disabled={cmd.busy} onClick={() => void approve()}>Aprovar esta revisão</button>}
          {d.review_state === 'APPROVED' && <button className="btn" disabled title="Envio desligado: emissor não homologado">Enviar nota aprovada</button>}
        </div>
      )}
      {owner && d.official_status === 'NOT_SENT' && (
        <section className="card">
          <div className="card-head"><h2>Nota emitida no emissor atual</h2></div>
          <p className="muted" style={{ marginBottom: 12 }}>Depois de autorizada fora do Ninebike, registre a chave para vincular ao pedido. Isso não emite nem reemite nada.</p>
          <div className="form-grid">
            <Field label="Chave de acesso (44 dígitos)">{(p) => <input {...p} className="input mono" value={ev.key} onChange={(e) => setEv({ ...ev, key: e.target.value })} />}</Field>
            <Field label="Série" optional>{(p) => <input {...p} className="input" value={ev.series} onChange={(e) => setEv({ ...ev, series: e.target.value })} />}</Field>
            <Field label="Número" optional>{(p) => <input {...p} className="input" value={ev.number} onChange={(e) => setEv({ ...ev, number: e.target.value })} />}</Field>
            <Field label="Protocolo" optional>{(p) => <input {...p} className="input" value={ev.protocol} onChange={(e) => setEv({ ...ev, protocol: e.target.value })} />}</Field>
          </div>
          <div className="form-actions" style={{ marginTop: 12 }}><button className="btn btn-primary" disabled={cmd.busy || !ev.key.trim()} onClick={async () => {
            const body: Record<string, unknown> = { expected_version: d.version, access_key: ev.key };
            for (const k of ['series', 'number', 'protocol'] as const) if (ev[k].trim()) body[k] = ev[k].trim();
            if (await cmd.run('POST', `/api/v1/fiscal-documents/${d.id}/external-evidence`, body, { success: 'Nota vinculada ao pedido.' })) doc.reload();
          }}>Registrar nota autorizada</button></div>
        </section>
      )}
      {d.access_key && <section className="card"><div className="card-head"><h2>Nota autorizada</h2></div><p className="mono">{d.access_key}</p>
        <p className="subtle">{d.series ? `Série ${d.series} · ` : ''}{d.number ? `Nº ${d.number}` : ''}</p></section>}
      <MfaPrompt open={mfa} onCancel={() => setMfa(false)} onDone={() => { setMfa(false); void approve(); }} />
    </>
  );
}

export function FiscalSettingsCard() {
  const cfg = useLoad(() => api.get<{ mode: string; issuer: Record<string, string>; version: number }>('/api/v1/admin/fiscal-configurations'), []);
  const [f, setF] = useState({ legal_name: '', cnpj: '', state_registration: '', state: '', tax_regime: 'SIMPLES_NACIONAL' });
  const cmd = useCommand();
  useEffect(() => { if (cfg.data?.issuer?.cnpj) setF({ ...f, ...cfg.data.issuer }); }, [cfg.data?.version]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!cfg.data) return null;
  return (
    <section className="card">
      <div className="card-head"><h2>Fiscal · emitente</h2><Status tone="warn">Envio desligado (sem provedor homologado)</Status></div>
      <div className="form-grid">
        <Field label="Razão social">{(p) => <input {...p} className="input" value={f.legal_name} onChange={(e) => setF({ ...f, legal_name: e.target.value })} />}</Field>
        <Field label="CNPJ">{(p) => <input {...p} className="input" value={f.cnpj} onChange={(e) => setF({ ...f, cnpj: e.target.value })} />}</Field>
        <Field label="Inscrição estadual" optional>{(p) => <input {...p} className="input" value={f.state_registration ?? ''} onChange={(e) => setF({ ...f, state_registration: e.target.value })} />}</Field>
        <Field label="UF">{(p) => <input {...p} className="input" maxLength={2} value={f.state} onChange={(e) => setF({ ...f, state: e.target.value })} />}</Field>
        <Field label="Regime">{(p) => <select {...p} className="input" value={f.tax_regime} onChange={(e) => setF({ ...f, tax_regime: e.target.value })}>
          <option value="SIMPLES_NACIONAL">Simples Nacional</option><option value="LUCRO_PRESUMIDO">Lucro Presumido</option><option value="LUCRO_REAL">Lucro Real</option></select>}</Field>
      </div>
      {cmd.error != null && <div className="alert alert-danger" style={{ marginTop: 12 }}>{describeError(cmd.error)}</div>}
      <div className="form-actions" style={{ marginTop: 12 }}><button className="btn btn-primary" disabled={cmd.busy} onClick={async () => {
        const issuer: Record<string, string> = { legal_name: f.legal_name, cnpj: f.cnpj, state: f.state, tax_regime: f.tax_regime };
        if (f.state_registration?.trim()) issuer.state_registration = f.state_registration.trim();
        if (await cmd.run('PATCH', '/api/v1/admin/fiscal-configurations', { expected_version: cfg.data!.version, issuer }, { success: 'Emitente salvo.' })) cfg.reload();
      }}>Salvar emitente</button></div>
    </section>
  );
}
