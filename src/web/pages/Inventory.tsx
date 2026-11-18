import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { HttpError, api, describeError, fieldOf } from '../api';
import { PageHead, useCommand } from '../components/Shell';
import { Dialog, Empty, ErrorBox, Field, Icon, Loading, Status, centsToInput, formatCents, formatInstant, parseMoneyInput, useLoad, useToast } from '../components/ui';
import { useSession } from '../session';

type Counts = { known: boolean; physical_on_hand: number | null; available: number | null; reserved: number | null; committed: number | null; inspection_maintenance: number | null };
type Product = {
  id: string; name: string; sku: string; type: 'BIKE' | 'ACCESSORY' | null; active: boolean; sale_price_cents: string | null;
  reference_cost_cents?: string | null; brand: string | null; category: string | null; size: string | null; color: string | null;
  location: string | null; minimum_stock: number | null; warranty_note: string | null; variant_description: string | null;
  primary_photo_id: string | null; counts: Counts; inventory_version: number; version: number; supplier_name?: string | null;
};
type Unit = { id: string; internal_code: string; serial_number: string | null; chassis_number: string | null; state: string; version: number; acquisition_cost_cents?: string | null };
type ProductDetail = Product & {
  units: Unit[] | null; photos: Array<{ id: string }>;
  movements: Array<{ id: string; kind: string; quantity_delta: number; unit_code: string | null; reason: string; actor_name: string; created_at: string; cost_snapshot_cents: string | null }> | null;
};

const UNIT_STATE: Record<string, [string, 'ok' | 'warn' | 'info' | 'neutral']> = {
  IN_STOCK: ['Disponível', 'ok'], RESERVED: ['Reservada', 'warn'], COMMITTED: ['Vendida (aguardando entrega)', 'info'],
  INSPECTION: ['Em inspeção', 'warn'], MAINTENANCE: ['Em manutenção', 'warn'],
};
const MOVE: Record<string, string> = { RECEIPT: 'Entrada', ADJUSTMENT_IN: 'Ajuste (+)', ADJUSTMENT_OUT: 'Baixa', RECOUNT_IN: 'Recontagem (+)', RECOUNT_OUT: 'Recontagem (−)' };

function Photo({ id, size = 40 }: { id: string | null; size?: number }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    if (id) api.get<{ url: string }>(`/api/v1/attachments/${id}/access`).then((r) => alive && setUrl(r.url), () => {});
    return () => { alive = false; };
  }, [id]);
  return <span className="thumb" style={{ width: size, height: size }}>{url ? <img src={url} alt="" /> : <Icon name="bike" />}</span>;
}

export function InventoryPage() {
  const { can } = useSession();
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [type, setType] = useState('');
  const [creating, setCreating] = useState(false);
  const nav = useNavigate();
  const list = useLoad(() => api.page<Product>(`/api/v1/catalog/products?limit=100${query ? `&q=${encodeURIComponent(query)}` : ''}${type ? `&type=${type}` : ''}`), [query, type]);
  return (
    <>
      <PageHead title="Catálogo e estoque" subtitle="Disponível = físico em loja menos reservado, vendido e em inspeção.">
        {can('catalog.manage') && <button className="btn btn-primary" onClick={() => setCreating(true)}><Icon name="plus" /> Novo produto</button>}
      </PageHead>
      <form className="toolbar" role="search" onSubmit={(e) => { e.preventDefault(); setQuery(q.trim()); }}>
        <div className="field search"><label htmlFor="iq" className="visually-hidden">Buscar</label>
          <input id="iq" className="input" placeholder="Buscar por modelo, SKU ou marca" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <div className="segmented" role="group" aria-label="Tipo">
          {[['', 'Todos'], ['BIKE', 'Bikes'], ['ACCESSORY', 'Acessórios']].map(([v, l]) => <button type="button" key={v} aria-pressed={type === v} onClick={() => setType(v)}>{l}</button>)}
        </div>
        <button className="btn"><Icon name="search" /> Buscar</button>
      </form>
      {list.loading ? <Loading /> : list.error ? <ErrorBox error={list.error} onRetry={list.reload} /> : !list.data?.data.length ? (
        <Empty title="Nenhum produto cadastrado.">{can('catalog.manage') && <button className="btn btn-primary" onClick={() => setCreating(true)}>Cadastrar modelo</button>}</Empty>
      ) : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Modelo</th><th>SKU</th><th className="num">Preço</th><th className="num">Físico</th><th className="num">Disponível</th><th className="num">Reservado</th><th className="num">Vendido</th><th className="num">Inspeção</th></tr></thead>
          <tbody>{list.data.data.map((p) => (
            <tr key={p.id}>
              <td><div className="cell-flex"><Photo id={p.primary_photo_id} /><div><Link className="row-link" to={`/app/estoque/${p.id}`}>{p.name}</Link>
                <div className="subtle">{[p.type === 'BIKE' ? 'Bike' : 'Acessório', p.brand, p.size, p.color].filter(Boolean).join(' · ')}</div></div></div></td>
              <td className="mono">{p.sku}</td>
              <td className="num">{p.sale_price_cents ? formatCents(p.sale_price_cents) : <Status tone="warn">Sem preço</Status>}</td>
              {p.counts.known ? <>
                <td className="num">{p.counts.physical_on_hand}</td>
                <td className="num" style={{ fontWeight: 600 }}>{p.counts.available}</td>
                <td className="num">{p.counts.reserved}</td><td className="num">{p.counts.committed}</td><td className="num">{p.counts.inspection_maintenance}</td>
              </> : <td colSpan={5}><Status tone="warn">Abertura de estoque não conferida</Status></td>}
            </tr>))}</tbody>
        </table></div>
      )}
      <ProductCreateDialog open={creating} onClose={() => setCreating(false)} onCreated={(id) => nav(`/app/estoque/${id}`)} />
    </>
  );
}

function ProductCreateDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const { can } = useSession();
  const empty = { name: '', type: 'BIKE', qty: '0', price: '', cost: '', serials: '', brand: '', category: '', size: '', color: '', location: '', minimum: '' };
  const [f, setF] = useState(empty);
  const [localErr, setLocalErr] = useState<Record<string, string>>({});
  const cmd = useCommand();
  const fe = (k: string) => localErr[k] ?? (fieldOf(cmd.error)?.startsWith(k) ? describeError(cmd.error) : null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    const qty = Number(f.qty);
    if (!Number.isInteger(qty) || qty < 0 || qty > 200) errs.initial_quantity = 'Informe um número inteiro de 0 a 200.';
    const price = parseMoneyInput(f.price);
    const cost = parseMoneyInput(f.cost);
    if (price === undefined) errs.sale_price_cents = 'Use o formato 12.900,00.';
    if (cost === undefined) errs.acquisition_cost_cents = 'Use o formato 8.500,00.';
    const serials = f.serials.split(/\n|,/).map((s) => s.trim()).filter(Boolean);
    if (serials.length && serials.length !== qty) errs.initial_units = `Informe ${qty} séries (uma por bike) ou deixe em branco para preencher depois.`;
    setLocalErr(errs);
    if (Object.keys(errs).length) return;
    const body: Record<string, unknown> = { name: f.name, type: f.type, initial_quantity: qty };
    if (price) body.sale_price_cents = price;
    if (cost && qty > 0) body.acquisition_cost_cents = cost;
    if (serials.length && f.type === 'BIKE') body.initial_units = serials.map((s) => ({ serial_number: s }));
    for (const k of ['brand', 'category', 'size', 'color', 'location'] as const) if (f[k].trim()) body[k] = f[k];
    if (f.minimum.trim()) body.minimum_stock = Number(f.minimum);
    const r = await cmd.run<{ id: string }>('POST', '/api/v1/catalog/products', body, { success: 'Produto cadastrado.' });
    if (r) { setF(empty); onClose(); onCreated(r.id); }
  }
  return (
    <Dialog open={open} title="Novo produto" onClose={onClose}>
      <form onSubmit={submit} noValidate style={{ display: 'grid', gap: 16 }}>
        {cmd.error instanceof HttpError && !fieldOf(cmd.error) && <div className="alert alert-danger" role="alert">{describeError(cmd.error)}</div>}
        <Field label="Nome do modelo" error={fe('name')}>{(p) => <input {...p} className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus />}</Field>
        <div className="form-grid">
          <Field label="Tipo">{(p) => <select {...p} className="input" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}><option value="BIKE">Bike (unidade por peça)</option><option value="ACCESSORY">Acessório / peça (quantidade)</option></select>}</Field>
          <Field label="Quantidade inicial" help="Gera entrada auditada. Zero não cria estoque." error={fe('initial_quantity')}>
            {(p) => <input {...p} className="input" inputMode="numeric" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value.replace(/\D/g, '') })} disabled={!can('inventory.manage')} />}</Field>
          <Field label="Preço de venda" optional help="Necessário para gerar proposta." error={fe('sale_price_cents')}>{(p) => <input {...p} className="input" inputMode="decimal" placeholder="12.900,00" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} />}</Field>
          {can('inventory.cost.read') && <Field label="Custo unitário desta entrada" optional help="Sem custo, a margem fica “não informada”." error={fe('acquisition_cost_cents')}>{(p) => <input {...p} className="input" inputMode="decimal" placeholder="8.500,00" value={f.cost} onChange={(e) => setF({ ...f, cost: e.target.value })} />}</Field>}
        </div>
        {f.type === 'BIKE' && Number(f.qty) > 0 && <Field label="Números de série" optional help="Um por linha, na mesma quantidade. Pode deixar em branco e preencher antes da entrega." error={fe('initial_units')}>
          {(p) => <textarea {...p} className="input mono" value={f.serials} onChange={(e) => setF({ ...f, serials: e.target.value })} />}</Field>}
        <details className="more"><summary>Detalhes (opcionais)</summary>
          <div className="form-grid" style={{ marginTop: 12 }}>
            {(['brand', 'category', 'size', 'color', 'location'] as const).map((k) => (
              <Field key={k} label={{ brand: 'Marca', category: 'Categoria', size: 'Tamanho', color: 'Cor', location: 'Localização' }[k]} optional>
                {(p) => <input {...p} className="input" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />}</Field>))}
            <Field label="Estoque mínimo" optional>{(p) => <input {...p} className="input" inputMode="numeric" value={f.minimum} onChange={(e) => setF({ ...f, minimum: e.target.value.replace(/\D/g, '') })} />}</Field>
          </div>
        </details>
        <div className="form-actions"><button type="button" className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" disabled={cmd.busy}>{cmd.busy ? 'Salvando…' : 'Cadastrar produto'}</button></div>
      </form>
    </Dialog>
  );
}

export function ProductDetailPage() {
  const { id } = useParams();
  const { can } = useSession();
  const p = useLoad(() => api.get<ProductDetail>(`/api/v1/catalog/products/${id}`), [id]);
  const [dlg, setDlg] = useState<null | 'receipt' | 'adjust' | 'recount' | 'edit' | 'archive' | { unit: Unit }>(null);
  if (p.loading && !p.data) return <Loading rows={5} />;
  if (p.error || !p.data) return <ErrorBox error={p.error ?? ''} onRetry={p.reload} />;
  const d = p.data;
  const manage = can('inventory.manage');
  const close = (reload = true) => { setDlg(null); if (reload) p.reload(); };
  return (
    <>
      <PageHead title={d.name} subtitle={`${d.sku} · ${d.type === 'BIKE' ? 'Bike' : 'Acessório'}${d.active ? '' : ' · Arquivado'}`}>
        {can('catalog.manage') && d.active && <button className="btn" onClick={() => setDlg('edit')}>Editar</button>}
        {manage && d.active && <>
          <button className="btn" onClick={() => setDlg('recount')}>Recontagem</button>
          <button className="btn" onClick={() => setDlg('adjust')}>Ajuste</button>
          <button className="btn btn-primary" onClick={() => setDlg('receipt')}>Registrar entrada</button></>}
      </PageHead>
      <div className="stats">
        {([['Físico em loja', d.counts.physical_on_hand], ['Disponível', d.counts.available], ['Reservado', d.counts.reserved], ['Vendido p/ entrega', d.counts.committed], ['Inspeção/manutenção', d.counts.inspection_maintenance]] as const).map(([k, v]) => (
          <div className="stat" key={k}><div className="k">{k}</div><div className="v">{d.counts.known ? v : '—'}</div></div>))}
      </div>
      <div className="grid-2">
        <section className="card">
          <div className="card-head"><h2>Produto</h2></div>
          <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <Photo id={d.primary_photo_id} size={120} />
            <dl className="kv" style={{ flex: 1 }}>
              <dt>Preço</dt><dd>{d.sale_price_cents ? formatCents(d.sale_price_cents) : 'Não definido'}</dd>
              {'reference_cost_cents' in d && <><dt>Custo de referência</dt><dd>{d.reference_cost_cents ? formatCents(d.reference_cost_cents) : 'Não informado'}</dd></>}
              {d.brand && <><dt>Marca</dt><dd>{d.brand}</dd></>}
              {d.size && <><dt>Tamanho</dt><dd>{d.size}</dd></>}
              {d.color && <><dt>Cor</dt><dd>{d.color}</dd></>}
              {d.location && <><dt>Localização</dt><dd>{d.location}</dd></>}
              {d.minimum_stock !== null && <><dt>Estoque mínimo</dt><dd>{d.minimum_stock}</dd></>}
            </dl>
          </div>
          {can('catalog.manage') && <PhotoUpload productId={d.id} onDone={() => p.reload()} />}
        </section>
        {d.units && (
          <section className="card">
            <div className="card-head"><h2>Unidades em loja</h2></div>
            {d.units.length === 0 ? <p className="muted">Nenhuma bike em loja.</p> : (
              <div className="table-wrap" style={{ border: 0 }}><table className="table">
                <thead><tr><th>Código</th><th>Série / chassi</th><th>Situação</th>{'acquisition_cost_cents' in (d.units[0] ?? {}) && <th className="num">Custo</th>}<th /></tr></thead>
                <tbody>{d.units.map((u) => (
                  <tr key={u.id}>
                    <td className="mono">{u.internal_code}</td>
                    <td className="mono">{u.serial_number ?? <span className="subtle">a preencher</span>}{u.chassis_number && ` / ${u.chassis_number}`}</td>
                    <td><Status tone={UNIT_STATE[u.state]?.[1] ?? 'neutral'}>{UNIT_STATE[u.state]?.[0] ?? u.state}</Status></td>
                    {'acquisition_cost_cents' in u && <td className="num">{u.acquisition_cost_cents ? formatCents(u.acquisition_cost_cents) : '—'}</td>}
                    <td>{manage && <button className="btn btn-sm" onClick={() => setDlg({ unit: u })}>Identificar</button>}</td>
                  </tr>))}</tbody>
              </table></div>
            )}
          </section>
        )}
      </div>
      {d.movements && (
        <section className="card">
          <div className="card-head"><h2>Movimentos</h2><span className="subtle">Histórico imutável</span></div>
          {d.movements.length === 0 ? <p className="muted">Nenhum movimento.</p> : (
            <div className="table-wrap" style={{ border: 0 }}><table className="table">
              <thead><tr><th>Quando</th><th>Tipo</th><th className="num">Qtd.</th><th>Unidade</th><th>Motivo</th><th>Por</th><th className="num">Custo</th></tr></thead>
              <tbody>{d.movements.map((m) => (
                <tr key={m.id}><td className="subtle">{formatInstant(m.created_at)}</td><td>{MOVE[m.kind] ?? m.kind}</td>
                  <td className="num">{m.quantity_delta > 0 ? `+${m.quantity_delta}` : `−${-m.quantity_delta}`}</td>
                  <td className="mono">{m.unit_code ?? '—'}</td><td>{m.reason}</td><td>{m.actor_name}</td>
                  <td className="num">{m.cost_snapshot_cents ? formatCents(m.cost_snapshot_cents) : '—'}</td></tr>))}</tbody>
            </table></div>
          )}
          {d.active && can('catalog.manage') && <div style={{ marginTop: 16 }}><button className="btn btn-ghost btn-danger" onClick={() => setDlg('archive')}>Arquivar produto</button></div>}
        </section>
      )}
      {dlg === 'receipt' && <ReceiptDialog p={d} onClose={close} />}
      {dlg === 'adjust' && <AdjustDialog p={d} onClose={close} />}
      {dlg === 'recount' && <RecountDialog p={d} onClose={close} />}
      {dlg === 'edit' && <EditProductDialog p={d} onClose={close} />}
      {dlg === 'archive' && <ArchiveDialog p={d} onClose={close} />}
      {dlg && typeof dlg === 'object' && <UnitDialog unit={dlg.unit} onClose={close} />}
    </>
  );
}

function StockDialog({ title, onClose, onSubmit, busy, error, children, cta }: { title: string; onClose: (r?: boolean) => void; onSubmit: () => void; busy: boolean; error: unknown; children: React.ReactNode; cta: string }) {
  return (
    <Dialog open title={title} onClose={() => onClose(false)}>
      <form onSubmit={(e) => { e.preventDefault(); onSubmit(); }} noValidate style={{ display: 'grid', gap: 16 }}>
        {!!error && <div className="alert alert-danger" role="alert">{describeError(error)}</div>}
        {children}
        <div className="form-actions"><button type="button" className="btn" onClick={() => onClose(false)}>Cancelar</button><button className="btn btn-primary" disabled={busy}>{cta}</button></div>
      </form>
    </Dialog>
  );
}

function ReceiptDialog({ p, onClose }: { p: ProductDetail; onClose: (r?: boolean) => void }) {
  const [f, setF] = useState({ qty: '1', reason: '', cost: '', doc: '', serials: '' });
  const [err, setErr] = useState<string | null>(null);
  const cmd = useCommand();
  return (
    <StockDialog title="Registrar entrada" onClose={onClose} busy={cmd.busy} error={cmd.error} cta="Registrar entrada" onSubmit={async () => {
      const qty = Number(f.qty);
      const cost = parseMoneyInput(f.cost);
      const serials = f.serials.split(/\n|,/).map((s) => s.trim()).filter(Boolean);
      if (!qty || qty > 200) return setErr('Quantidade de 1 a 200.');
      if (cost === undefined) return setErr('Custo no formato 8.500,00.');
      if (serials.length && serials.length !== qty) return setErr(`Informe ${qty} séries ou deixe em branco.`);
      setErr(null);
      const body: Record<string, unknown> = { product_id: p.id, expected_inventory_version: p.inventory_version, quantity: qty, reason: f.reason || 'Entrada de mercadoria' };
      if (cost) body.unit_acquisition_cost_cents = cost;
      if (f.doc.trim()) body.purchase_document_reference = f.doc.trim();
      if (serials.length) body.units = serials.map((s) => ({ serial_number: s }));
      if (await cmd.run('POST', '/api/v1/inventory/receipts', body, { success: 'Entrada registrada.' })) onClose();
    }}>
      {err && <div className="alert alert-danger">{err}</div>}
      <div className="form-grid">
        <Field label="Quantidade">{(x) => <input {...x} className="input" inputMode="numeric" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value.replace(/\D/g, '') })} />}</Field>
        <Field label="Custo unitário" optional help="Fica no histórico desta entrada.">{(x) => <input {...x} className="input" inputMode="decimal" value={f.cost} onChange={(e) => setF({ ...f, cost: e.target.value })} />}</Field>
        <Field label="Documento de compra" optional help="Ex.: NF 1234">{(x) => <input {...x} className="input" value={f.doc} onChange={(e) => setF({ ...f, doc: e.target.value })} />}</Field>
      </div>
      <Field label="Motivo" optional>{(x) => <input {...x} className="input" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="Entrada de mercadoria" />}</Field>
      {p.type === 'BIKE' && <Field label="Números de série" optional>{(x) => <textarea {...x} className="input mono" value={f.serials} onChange={(e) => setF({ ...f, serials: e.target.value })} />}</Field>}
    </StockDialog>
  );
}

function AdjustDialog({ p, onClose }: { p: ProductDetail; onClose: (r?: boolean) => void }) {
  const [dir, setDir] = useState<'out' | 'in'>('out');
  const [qty, setQty] = useState('1');
  const [reason, setReason] = useState('');
  const [units, setUnits] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const cmd = useCommand();
  const inStock = (p.units ?? []).filter((u) => u.state === 'IN_STOCK');
  return (
    <StockDialog title="Ajuste de estoque" onClose={onClose} busy={cmd.busy} error={cmd.error} cta="Registrar ajuste" onSubmit={async () => {
      const n = p.type === 'BIKE' && dir === 'out' ? units.length : Number(qty);
      if (!n) return setErr(p.type === 'BIKE' && dir === 'out' ? 'Marque as bikes que saem.' : 'Informe a quantidade.');
      if (!reason.trim()) return setErr('Informe o motivo.');
      setErr(null);
      const body: Record<string, unknown> = { product_id: p.id, expected_inventory_version: p.inventory_version, quantity_delta: dir === 'out' ? -n : n, reason };
      if (p.type === 'BIKE' && dir === 'out') body.unit_ids = units;
      if (await cmd.run('POST', '/api/v1/inventory/adjustments', body, { success: 'Ajuste registrado.' })) onClose();
    }}>
      {err && <div className="alert alert-danger">{err}</div>}
      <div className="segmented" role="group" aria-label="Direção"><button type="button" aria-pressed={dir === 'out'} onClick={() => setDir('out')}>Saída / perda</button><button type="button" aria-pressed={dir === 'in'} onClick={() => setDir('in')}>Entrada sem compra</button></div>
      {p.type === 'BIKE' && dir === 'out' ? (
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}><legend className="label" style={{ fontSize: 14, fontWeight: 500, marginBottom: 4 }}>Bikes que saem</legend>
          {inStock.length === 0 && <p className="muted">Nenhuma bike disponível. Reservadas/vendidas não podem ser baixadas aqui.</p>}
          {inStock.map((u) => <label key={u.id} className="check" style={{ display: 'flex' }}><input type="checkbox" checked={units.includes(u.id)} onChange={(e) => setUnits(e.target.checked ? [...units, u.id] : units.filter((x) => x !== u.id))} /> <span className="mono">{u.internal_code}</span> {u.serial_number && <span className="subtle">{u.serial_number}</span>}</label>)}
        </fieldset>
      ) : <Field label="Quantidade">{(x) => <input {...x} className="input" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value.replace(/\D/g, ''))} />}</Field>}
      <Field label="Motivo">{(x) => <input {...x} className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: avaria no transporte" />}</Field>
    </StockDialog>
  );
}

function RecountDialog({ p, onClose }: { p: ProductDetail; onClose: (r?: boolean) => void }) {
  const inStore = p.units ?? [];
  const [counted, setCounted] = useState(String(p.counts.physical_on_hand ?? 0));
  const [seen, setSeen] = useState<string[]>(inStore.map((u) => u.id));
  const [reason, setReason] = useState('Inventário');
  const cmd = useCommand();
  const n = p.type === 'BIKE' ? seen.length : Number(counted);
  const diff = n - (p.counts.physical_on_hand ?? 0);
  return (
    <StockDialog title="Recontagem" onClose={onClose} busy={cmd.busy} error={cmd.error} cta="Registrar recontagem" onSubmit={async () => {
      const body: Record<string, unknown> = { product_id: p.id, expected_inventory_version: p.inventory_version, counted_quantity: n, reason };
      if (p.type === 'BIKE' && diff < 0) body.observed_unit_ids = seen;
      if (await cmd.run('POST', '/api/v1/inventory/recounts', body, { success: 'Recontagem registrada.' })) onClose();
    }}>
      <p className="muted">Informe o que foi contado fisicamente. A diferença vira um movimento compensatório; nada do histórico é apagado.</p>
      {p.type === 'BIKE' ? (
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}><legend style={{ fontSize: 14, fontWeight: 500, marginBottom: 4 }}>Bikes encontradas na loja</legend>
          {inStore.map((u) => <label key={u.id} className="check" style={{ display: 'flex' }}><input type="checkbox" checked={seen.includes(u.id)} onChange={(e) => setSeen(e.target.checked ? [...seen, u.id] : seen.filter((x) => x !== u.id))} /> <span className="mono">{u.internal_code}</span> <Status tone={UNIT_STATE[u.state]?.[1] ?? 'neutral'}>{UNIT_STATE[u.state]?.[0]}</Status></label>)}
          <p className="subtle">Bikes a mais que não estão na lista: registre como entrada.</p>
        </fieldset>
      ) : <Field label="Quantidade contada">{(x) => <input {...x} className="input" inputMode="numeric" value={counted} onChange={(e) => setCounted(e.target.value.replace(/\D/g, ''))} />}</Field>}
      <p><strong>Diferença: {diff > 0 ? `+${diff}` : diff}</strong></p>
      <Field label="Motivo">{(x) => <input {...x} className="input" value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
    </StockDialog>
  );
}

function EditProductDialog({ p, onClose }: { p: ProductDetail; onClose: (r?: boolean) => void }) {
  const { can } = useSession();
  const [f, setF] = useState({ name: p.name, price: centsToInput(p.sale_price_cents), cost: centsToInput(p.reference_cost_cents), brand: p.brand ?? '', size: p.size ?? '', color: p.color ?? '', location: p.location ?? '', sku: p.sku });
  const [err, setErr] = useState<string | null>(null);
  const cmd = useCommand();
  return (
    <StockDialog title="Editar produto" onClose={onClose} busy={cmd.busy} error={cmd.error} cta="Salvar produto" onSubmit={async () => {
      const price = parseMoneyInput(f.price); const cost = parseMoneyInput(f.cost);
      if (price === undefined || cost === undefined) return setErr('Valores no formato 12.900,00.');
      setErr(null);
      const body: Record<string, unknown> = { expected_version: p.version };
      if (f.name !== p.name) body.name = f.name;
      if (f.sku !== p.sku) body.sku = f.sku;
      if (price !== p.sale_price_cents) body.sale_price_cents = price;
      if (can('inventory.cost.read') && cost !== (p.reference_cost_cents ?? null)) body.reference_cost_cents = cost;
      for (const k of ['brand', 'size', 'color', 'location'] as const) if (f[k] !== (p[k] ?? '')) body[k] = f[k].trim() || null;
      if (Object.keys(body).length === 1) return onClose(false);
      if (await cmd.run('PATCH', `/api/v1/catalog/products/${p.id}`, body, { success: 'Produto atualizado. Pedidos anteriores mantêm seus valores.' })) onClose();
    }}>
      {err && <div className="alert alert-danger">{err}</div>}
      <Field label="Nome">{(x) => <input {...x} className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
      <div className="form-grid">
        <Field label="SKU">{(x) => <input {...x} className="input mono" value={f.sku} onChange={(e) => setF({ ...f, sku: e.target.value })} />}</Field>
        <Field label="Preço de venda" optional>{(x) => <input {...x} className="input" inputMode="decimal" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} />}</Field>
        {can('inventory.cost.read') && <Field label="Custo de referência" optional help="Não altera custo de entradas já registradas.">{(x) => <input {...x} className="input" inputMode="decimal" value={f.cost} onChange={(e) => setF({ ...f, cost: e.target.value })} />}</Field>}
        {(['brand', 'size', 'color', 'location'] as const).map((k) => <Field key={k} label={{ brand: 'Marca', size: 'Tamanho', color: 'Cor', location: 'Localização' }[k]} optional>{(x) => <input {...x} className="input" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />}</Field>)}
      </div>
    </StockDialog>
  );
}

function ArchiveDialog({ p, onClose }: { p: ProductDetail; onClose: (r?: boolean) => void }) {
  const [reason, setReason] = useState('');
  const cmd = useCommand();
  return (
    <StockDialog title="Arquivar produto" onClose={onClose} busy={cmd.busy} error={cmd.error} cta="Arquivar" onSubmit={async () => {
      if (await cmd.run('POST', `/api/v1/catalog/products/${p.id}/archive`, { expected_version: p.version, reason }, { success: 'Produto arquivado.' })) onClose();
    }}>
      <p>O histórico e as vendas são preservados; o modelo deixa de aceitar novas entradas e propostas.</p>
      <Field label="Motivo">{(x) => <input {...x} className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: fora de linha" />}</Field>
    </StockDialog>
  );
}

function UnitDialog({ unit, onClose }: { unit: Unit; onClose: (r?: boolean) => void }) {
  const [serial, setSerial] = useState(unit.serial_number ?? '');
  const [chassis, setChassis] = useState(unit.chassis_number ?? '');
  const cmd = useCommand();
  return (
    <StockDialog title={`Identificar ${unit.internal_code}`} onClose={onClose} busy={cmd.busy} error={cmd.error} cta="Salvar identificação" onSubmit={async () => {
      const body: Record<string, unknown> = { expected_version: unit.version };
      if (serial !== (unit.serial_number ?? '')) body.serial_number = serial.trim() || null;
      if (chassis !== (unit.chassis_number ?? '')) body.chassis_number = chassis.trim() || null;
      if (Object.keys(body).length === 1) return onClose(false);
      if (await cmd.run('PATCH', `/api/v1/inventory/units/${unit.id}/identification`, body, { success: 'Identificação salva.' })) onClose();
    }}>
      <p className="muted">Preencha apenas o que estiver gravado na bike. Não invente número para completar o campo.</p>
      <Field label="Número de série" optional>{(x) => <input {...x} className="input mono" value={serial} onChange={(e) => setSerial(e.target.value)} />}</Field>
      <Field label="Chassi" optional>{(x) => <input {...x} className="input mono" value={chassis} onChange={(e) => setChassis(e.target.value)} />}</Field>
    </StockDialog>
  );
}

function PhotoUpload({ productId, onDone }: { productId: string; onDone: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const reg = useCommand();
  const done = useCommand();
  const [unavailable, setUnavailable] = useState(false);
  async function pick(file: File) {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return toast('Use JPG, PNG ou WebP.', 'error');
    if (file.size > 8 * 1024 * 1024) return toast('Imagem acima de 8 MB.', 'error');
    setBusy(true);
    try {
      const r = await reg.run<{ id: string; upload_url: string }>('POST', '/api/v1/attachments', { product_id: productId, content_type: file.type, size_bytes: file.size },
        { onError: (e) => { if (e instanceof HttpError && e.code === 'CAPABILITY_UNAVAILABLE') setUnavailable(true); } });
      if (!r) return;
      const up = await fetch(r.upload_url, { method: 'PUT', headers: { 'content-type': file.type }, body: file });
      if (!up.ok) return toast('Falha no envio da foto. O produto não foi alterado; tente de novo.', 'error');
      const c = await done.run<{ state: string }>('POST', `/api/v1/attachments/${r.id}/complete`, undefined);
      if (c?.state === 'READY') { toast('Foto adicionada.'); onDone(); } else if (c) toast('Arquivo recusado: não é uma imagem válida.', 'error');
    } finally {
      setBusy(false);
    }
  }
  if (unavailable) return <p className="subtle" style={{ marginTop: 16 }}>Envio de fotos ainda não habilitado neste ambiente (Storage não configurado).</p>;
  return (
    <div style={{ marginTop: 16 }}>
      <label className="btn btn-sm" aria-disabled={busy}>
        <Icon name="plus" /> {busy ? 'Enviando…' : 'Adicionar foto'}
        <input type="file" accept="image/jpeg,image/png,image/webp" className="visually-hidden" disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void pick(f); }} />
      </label>
    </div>
  );
}
