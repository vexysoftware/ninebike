import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor, TouchSensor, closestCenter, pointerWithin, rectIntersection, useDroppable,
  useSensor, useSensors, type CollisionDetection, type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { api, describeError, fieldOf } from '../api';
import { PageHead, useCommand } from '../components/Shell';
import {
  Dialog, Empty, ErrorBox, Field, Icon, Loading, Status, centsToInput, formatCents, formatDateOnly, formatInstant, formatPhone,
  parseMoneyInput, useLoad, waLink,
} from '../components/ui';
import { useSession } from '../session';
import { ContactCreateDialog, KIND, type Contact } from './Contacts';

type Card = {
  id: string; contact_id: string; contact_name: string; mobile_phone: string | null; stage_id: string; position: number; owner_id: string;
  owner_name: string; title: string; expected_value_cents: string | null; last_activity_at: string | null; next_contact_at: string | null;
  version: number; source: string; tags: string[]; expected_purchase_date: string | null; lost_reason: string | null;
};
type Stage = { id: string; name: string; kind: 'OPEN' | 'WON' | 'LOST'; position: number; version: number; cards_version: number; total: number; cards: Card[] };
type Move = { card: Card; from: Stage; to: Stage; before?: string; after?: string };

export function PipelinePage() {
  const { session } = useSession();
  const [params, setParams] = useSearchParams();
  const [view, setView] = useState<'board' | 'list'>(() => (sessionStorage.getItem('nb-pipeline-view') as 'board' | 'list') || 'board');
  const [q, setQ] = useState('');
  const [filters, setFilters] = useState({ q: '', owner_id: '' });
  const qs = new URLSearchParams({ limit: '100', ...(filters.q ? { q: filters.q } : {}), ...(filters.owner_id ? { owner_id: filters.owner_id } : {}) });
  const board = useLoad(() => api.get<Stage[]>(`/api/v1/pipeline-stages?${qs}`), [qs.toString()]);
  const users = useLoad(() => (session?.profile === 'OWNER' ? api.get<{ users: Array<{ id: string; name: string; active: boolean }> }>('/api/v1/admin/users') : Promise.resolve({ users: [] })), [session?.profile]);
  const [stages, setStages] = useState<Stage[]>([]);
  const [pending, setPending] = useState<string | null>(null);
  const [lossFor, setLossFor] = useState<Move | null>(null);
  const [moveMenu, setMoveMenu] = useState<Card | null>(null);
  const [newLead, setNewLead] = useState(false);
  const [announce, setAnnounce] = useState('');
  const openId = params.get('abrir');
  const cmd = useCommand();
  useEffect(() => { if (board.data) setStages(board.data); }, [board.data]);
  useEffect(() => { try { sessionStorage.setItem('nb-pipeline-view', view); } catch { /* opcional */ } }, [view]);

  async function commit(m: Move, lossReason?: string) {
    const body: Record<string, unknown> = {
      expected_version: m.card.version, stage_id: m.to.id, expected_stage_version: m.to.version,
      expected_source_cards_version: m.from.cards_version, expected_target_cards_version: m.to.cards_version,
      ...(m.before ? { before_opportunity_id: m.before } : m.after ? { after_opportunity_id: m.after } : {}),
      ...(lossReason ? { loss_reason: lossReason } : {}),
    };
    // Antecipação visual com pendência até o commit; erro conclusivo volta à ordem confirmada do servidor.
    setStages((cur) => applyLocal(cur, m));
    setPending(m.card.id);
    const r = await cmd.run('POST', `/api/v1/opportunities/${m.card.id}/moves`, body);
    setPending(null);
    // Sucesso anuncia; conflito/erro já avisou via toast. Em ambos os casos relê a ordem confirmada.
    if (r) setAnnounce(`${m.card.title} movido para ${m.to.name}.`);
    board.reload();
  }
  function requestMove(m: Move) {
    if (m.to.kind === 'LOST' && m.from.kind !== 'LOST') setLossFor(m);
    else void commit(m);
  }

  return (
    <>
      <PageHead title="Pipeline" subtitle="Valor potencial não é faturamento; mover etapa não cria cobrança nem baixa estoque.">
        <div className="segmented" role="group" aria-label="Visualização">
          <button aria-pressed={view === 'board'} onClick={() => setView('board')}><Icon name="kanban" /> Quadro</button>
          <button aria-pressed={view === 'list'} onClick={() => setView('list')}><Icon name="list" /> Lista</button>
        </div>
        <button className="btn btn-primary" onClick={() => setNewLead(true)}><Icon name="plus" /> Novo lead</button>
      </PageHead>
      <form className="toolbar" role="search" onSubmit={(e) => { e.preventDefault(); setFilters({ ...filters, q: q.trim() }); }}>
        <div className="field search"><label htmlFor="pq" className="visually-hidden">Buscar</label>
          <input id="pq" className="input" placeholder="Buscar por nome ou celular" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        {session?.profile === 'OWNER' && (
          <div className="field"><label htmlFor="owner" className="visually-hidden">Vendedor</label>
            <select id="owner" className="input" value={filters.owner_id} onChange={(e) => setFilters({ ...filters, owner_id: e.target.value })}>
              <option value="">Todos os vendedores</option>
              {users.data?.users.filter((u) => u.active).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select></div>
        )}
        <button className="btn"><Icon name="search" /> Filtrar</button>
      </form>
      <div className="visually-hidden" aria-live="polite">{announce}</div>
      {board.loading && !stages.length ? <Loading rows={4} /> : board.error ? <ErrorBox error={board.error} onRetry={board.reload} /> :
        view === 'board'
          ? <Board stages={stages} pending={pending} onMove={requestMove} onOpen={(id) => setParams({ abrir: id })} onMenu={setMoveMenu} />
          : <ListView stages={stages} onOpen={(id) => setParams({ abrir: id })} onMenu={setMoveMenu} />}

      <LossDialog move={lossFor} onCancel={() => { setLossFor(null); }} onConfirm={(reason) => { const m = lossFor!; setLossFor(null); void commit(m, reason); }} />
      <MoveToDialog card={moveMenu} stages={stages} onClose={() => setMoveMenu(null)} onMove={(m) => { setMoveMenu(null); requestMove(m); }} />
      <NewLeadFlow open={newLead} onClose={() => setNewLead(false)} onCreated={(id) => { setNewLead(false); board.reload(); setParams({ abrir: id }); }} />
      {openId && <OpportunityDialog id={openId} onClose={() => { setParams({}); board.reload(); }} owners={users.data?.users ?? []} />}
    </>
  );
}

function applyLocal(stages: Stage[], m: Move): Stage[] {
  return stages.map((s) => {
    let cards = s.cards.filter((c) => c.id !== m.card.id);
    if (s.id === m.to.id) {
      const idx = m.before ? cards.findIndex((c) => c.id === m.before) : m.after ? cards.findIndex((c) => c.id === m.after) + 1 : cards.length;
      cards = [...cards.slice(0, idx < 0 ? cards.length : idx), { ...m.card, stage_id: m.to.id }, ...cards.slice(idx < 0 ? cards.length : idx)];
    }
    const total = s.total + (s.id === m.to.id && m.from.id !== m.to.id ? 1 : 0) - (s.id === m.from.id && m.from.id !== m.to.id ? 1 : 0);
    return { ...s, cards, total };
  });
}

function Board({ stages, pending, onMove, onOpen, onMenu }: { stages: Stage[]; pending: string | null; onMove: (m: Move) => void; onOpen: (id: string) => void; onMenu: (c: Card) => void }) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: (event, args) => {
      // Setas navegam entre cartões; etapa vazia é alcançada pelo menu “Mover para”.
      const all = args.context.droppableContainers;
      const cardsOnly = new Proxy(all, {
        get(target, prop) {
          if (prop === 'getEnabled') return () => target.getEnabled().filter((c) => !stageIdsRef.current.has(String(c.id)));
          const v = Reflect.get(target, prop, target);
          return typeof v === 'function' ? v.bind(target) : v;
        },
      });
      return sortableKeyboardCoordinates(event, { ...args, context: { ...args.context, droppableContainers: cardsOnly } });
    } }),
  );
  const [active, setActive] = useState<Card | null>(null);
  const stageIdsRef = useRef(new Set<string>());
  stageIdsRef.current = new Set(stages.map((s) => s.id));
  const byCard = useMemo(() => new Map(stages.flatMap((s) => s.cards.map((c) => [c.id, s] as const))), [stages]);
  // Primeiro decide a coluna (ponteiro ou retângulo do cartão no teclado); depois o cartão mais próximo dentro dela.
  const collision: CollisionDetection = (args) => {
    const ids = new Set(stages.map((s) => s.id));
    const cols = args.droppableContainers.filter((c) => ids.has(String(c.id)));
    const byPointer = pointerWithin({ ...args, droppableContainers: cols });
    const colHits = byPointer.length ? byPointer : rectIntersection({ ...args, droppableContainers: cols });
    const col = colHits[0]?.id;
    if (!col) return [];
    const cards = args.droppableContainers.filter((c) => byCard.get(String(c.id))?.id === col);
    const cardHits = closestCenter({ ...args, droppableContainers: cards });
    return cardHits.length ? cardHits : colHits;
  };
  function end(e: DragEndEvent) {
    setActive(null);
    const card = e.active.data.current?.card as Card | undefined;
    if (!card || !e.over) return;
    const from = byCard.get(card.id)!;
    const overId = String(e.over.id);
    const to = stages.find((s) => s.id === overId) ?? byCard.get(overId);
    if (!to) return;
    let next: Card[];
    if (from.id === to.id) {
      const oldIdx = from.cards.findIndex((c) => c.id === card.id);
      const newIdx = overId === to.id ? from.cards.length - 1 : from.cards.findIndex((c) => c.id === overId);
      if (oldIdx === newIdx) return;
      next = arrayMove(from.cards, oldIdx, newIdx);
    } else {
      let i = overId === to.id ? to.cards.length : Math.max(0, to.cards.findIndex((c) => c.id === overId));
      const a = e.active.rect.current.translated;
      if (overId !== to.id && a && a.top + a.height / 2 > e.over.rect.top + e.over.rect.height / 2) i += 1;
      next = [...to.cards.slice(0, i), card, ...to.cards.slice(i)];
    }
    const pos = next.findIndex((c) => c.id === card.id);
    const before = next[pos + 1]?.id;
    onMove({ card, from, to, ...(before ? { before } : next[pos - 1] ? { after: next[pos - 1].id } : {}) });
  }
  if (!stages.length) return <Empty title="Nenhuma etapa ativa." />;
  return (
    <DndContext sensors={sensors} collisionDetection={collision}
      onDragStart={(e: DragStartEvent) => setActive((e.active.data.current?.card as Card) ?? null)} onDragEnd={end} onDragCancel={() => setActive(null)}
      accessibility={{ announcements: {
        onDragStart: ({ active: a }) => `Movendo ${(a.data.current?.card as Card)?.title}.`,
        onDragOver: ({ over }) => (over ? `Sobre ${stages.find((s) => s.id === over.id)?.name ?? byCard.get(String(over.id))?.name ?? ''}.` : 'Fora das etapas.'),
        onDragEnd: ({ over }) => (over ? 'Solto. Salvando.' : 'Cancelado.'),
        onDragCancel: () => 'Movimento cancelado.',
      }, screenReaderInstructions: { draggable: 'Pressione espaço para pegar, setas para mover, espaço para soltar e Escape para cancelar. Também é possível usar o menu Mover para.' } }}>
      <div className="board">
        {stages.map((s) => <Column key={s.id} stage={s} pending={pending} onOpen={onOpen} onMenu={onMenu} />)}
      </div>
      <DragOverlay>{active ? <div className="opp-card drag-overlay"><span className="handle"><Icon name="grip" /></span><span className="title">{active.title}</span></div> : null}</DragOverlay>
    </DndContext>
  );
}

function Column({ stage, pending, onOpen, onMenu }: { stage: Stage; pending: string | null; onOpen: (id: string) => void; onMenu: (c: Card) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  const sum = stage.cards.reduce((a, c) => (c.expected_value_cents ? a + BigInt(c.expected_value_cents) : a), 0n);
  return (
    <section className={`column column-kind-${stage.kind}`} data-over={isOver} aria-labelledby={`col-${stage.id}`}>
      <div className="column-head">
        <h2 id={`col-${stage.id}`}>{stage.name}</h2>
        <span className="count" title="Total no seu escopo">{stage.total}</span>
      </div>
      {sum > 0n && <div className="subtle" style={{ padding: '4px 16px 0' }}>Potencial {formatCents(String(sum))}</div>}
      <SortableContext items={stage.cards.map((c) => c.id)} strategy={verticalListSortingStrategy}>
        <div ref={setNodeRef} className="column-body">
          {stage.cards.map((c) => <OppCard key={c.id} card={c} pending={pending === c.id} onOpen={onOpen} onMenu={onMenu} />)}
          {stage.cards.length === 0 && <p className="subtle" style={{ textAlign: 'center', padding: 16 }}>Solte aqui</p>}
          {stage.total > stage.cards.length && <p className="subtle" style={{ textAlign: 'center' }}>+{stage.total - stage.cards.length} não exibidos</p>}
        </div>
      </SortableContext>
    </section>
  );
}

function OppCard({ card, pending, onOpen, onMenu }: { card: Card; pending: boolean; onOpen: (id: string) => void; onMenu: (c: Card) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging, setActivatorNodeRef } = useSortable({ id: card.id, data: { card } });
  return (
    <article ref={setNodeRef} className="opp-card" data-dragging={isDragging} data-pending={pending} aria-busy={pending}
      style={{ transform: CSS.Transform.toString(transform), transition }}>
      <button ref={setActivatorNodeRef} className="handle" {...attributes} {...listeners} aria-label={`Arrastar ${card.title}`}><Icon name="grip" /></button>
      <a className="title" href={`?abrir=${card.id}`} onClick={(e) => { e.preventDefault(); onOpen(card.id); }}>{card.title}</a>
      <button className="btn btn-ghost btn-sm icon-btn menu" style={{ minHeight: 32, minWidth: 32 }} aria-label={`Mover ${card.title} para…`} onClick={() => onMenu(card)}><Icon name="more" /></button>
      <span className="meta">{formatPhone(card.mobile_phone)} · {card.owner_name}</span>
      {(card.expected_value_cents || card.next_contact_at) && <span className="meta">
        {card.expected_value_cents && formatCents(card.expected_value_cents)}{card.expected_value_cents && card.next_contact_at && ' · '}
        {card.next_contact_at && `Retorno ${formatInstant(card.next_contact_at)}`}</span>}
      {pending && <span className="meta">Salvando…</span>}
    </article>
  );
}

function ListView({ stages, onOpen, onMenu }: { stages: Stage[]; onOpen: (id: string) => void; onMenu: (c: Card) => void }) {
  const rows = stages.flatMap((s) => s.cards.map((c) => ({ c, s })));
  if (!rows.length) return <Empty title="Nenhuma oportunidade no filtro." />;
  return (
    <div className="table-wrap"><table className="table">
      <thead><tr><th>Oportunidade</th><th>Etapa</th><th>Celular</th><th>Responsável</th><th className="num">Potencial</th><th>Retorno</th><th><span className="visually-hidden">Ações</span></th></tr></thead>
      <tbody>{rows.map(({ c, s }) => (
        <tr key={c.id}>
          <td><a className="row-link" href={`?abrir=${c.id}`} onClick={(e) => { e.preventDefault(); onOpen(c.id); }}>{c.title}</a></td>
          <td><Status tone={s.kind === 'WON' ? 'ok' : s.kind === 'LOST' ? 'danger' : 'neutral'}>{s.name}</Status></td>
          <td className="mono">{formatPhone(c.mobile_phone)}</td><td>{c.owner_name}</td>
          <td className="num">{c.expected_value_cents ? formatCents(c.expected_value_cents) : '—'}</td>
          <td className="subtle">{formatInstant(c.next_contact_at)}</td>
          <td><button className="btn btn-sm" onClick={() => onMenu(c)}>Mover para…</button></td>
        </tr>))}</tbody>
    </table></div>
  );
}

function MoveToDialog({ card, stages, onClose, onMove }: { card: Card | null; stages: Stage[]; onClose: () => void; onMove: (m: Move) => void }) {
  const from = card ? stages.find((s) => s.id === card.stage_id) ?? stages.find((s) => s.cards.some((c) => c.id === card.id)) : undefined;
  const [to, setTo] = useState('');
  const [where, setWhere] = useState<'end' | 'start'>('end');
  useEffect(() => { if (from) setTo(from.id); }, [card?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!card || !from) return <Dialog open={false} title="" onClose={onClose}>{null}</Dialog>;
  const target = stages.find((s) => s.id === to) ?? from;
  return (
    <Dialog open title={`Mover “${card.title}”`} onClose={onClose}
      footer={<div className="form-actions"><button className="btn" onClick={onClose}>Cancelar</button>
        <button className="btn btn-primary" onClick={() => {
          const rest = target.cards.filter((c) => c.id !== card.id);
          const anchor = rest.length === 0 ? {} : where === 'start' ? { before: rest[0].id } : { after: rest[rest.length - 1].id };
          onMove({ card, from, to: target, ...anchor });
        }}>Mover</button></div>}>
      <Field label="Etapa">{(p) => <select {...p} className="input" value={to} onChange={(e) => setTo(e.target.value)}>
        {stages.map((s) => <option key={s.id} value={s.id}>{s.name}{s.id === from.id ? ' (atual)' : ''}</option>)}</select>}</Field>
      <Field label="Posição">{(p) => <select {...p} className="input" value={where} onChange={(e) => setWhere(e.target.value as 'end' | 'start')}>
        <option value="start">No início da etapa</option><option value="end">No fim da etapa</option></select>}</Field>
    </Dialog>
  );
}

function LossDialog({ move, onCancel, onConfirm }: { move: Move | null; onCancel: () => void; onConfirm: (r: string) => void }) {
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  return (
    <Dialog open={!!move} title="Motivo da perda" onClose={onCancel}
      footer={<div className="form-actions"><button className="btn" onClick={onCancel}>Cancelar</button>
        <button className="btn btn-primary" onClick={() => { if (!reason.trim()) { setErr('Informe o motivo.'); return; } setErr(null); onConfirm(reason.trim()); setReason(''); }}>Registrar perda</button></div>}>
      <p>Por que “{move?.card.title}” foi perdida? O motivo fica no histórico.</p>
      <Field label="Motivo" error={err}>{(p) => <input {...p} className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: comprou em outra loja" autoFocus />}</Field>
    </Dialog>
  );
}

function NewLeadFlow({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (oppId: string) => void }) {
  const [mode, setMode] = useState<'pick' | 'new'>('new');
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Contact[]>([]);
  const cmd = useCommand();
  async function search(e: FormEvent) {
    e.preventDefault();
    setResults((await api.page<Contact>(`/api/v1/contacts?limit=10&role=CUSTOMER&q=${encodeURIComponent(q)}`)).data);
  }
  async function createOpp(contactId: string) {
    const r = await cmd.run<{ id: string }>('POST', '/api/v1/opportunities', { contact_id: contactId }, { success: 'Oportunidade criada.' });
    if (r) onCreated(r.id);
  }
  if (mode === 'new') return (
    <>
      <ContactCreateDialog open={open} onClose={onClose} onCreated={(id) => void createOpp(id)} />
      {open && <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 60 }}>
        <button className="btn" onClick={() => setMode('pick')}>Já é cliente? Buscar contato existente</button></div>}
    </>
  );
  return (
    <Dialog open={open} title="Nova oportunidade para contato existente" onClose={() => { setMode('new'); onClose(); }}>
      <form onSubmit={search} className="toolbar"><div className="field search"><label htmlFor="sq" className="visually-hidden">Buscar contato</label>
        <input id="sq" className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nome ou celular" autoFocus /></div>
        <button className="btn">Buscar</button></form>
      <ul className="timeline">{results.map((c) => (
        <li key={c.id}><span className="dot" /><div className="unit-row"><span style={{ flex: 1 }}>{c.name} <span className="subtle">{formatPhone(c.mobile_phone)}</span></span>
          <button className="btn btn-sm btn-primary" disabled={cmd.busy} onClick={() => void createOpp(c.id)}>Criar oportunidade</button></div></li>))}</ul>
      <button className="btn btn-ghost" onClick={() => setMode('new')}>Cadastrar novo contato</button>
    </Dialog>
  );
}

type OppDetail = Card & {
  stage: { id: string; name: string; kind: string }; interest_product_id: string | null;
  activities: Array<{ id: string; kind: string; body: string; due_at: string | null; completed_at: string | null; author_name: string; created_at: string }>;
  history: Array<{ action: string; occurred_at: string; actor_name: string | null; details: Record<string, unknown> }>;
};

function OpportunityDialog({ id, onClose, owners }: { id: string; onClose: () => void; owners: Array<{ id: string; name: string; active: boolean }> }) {
  const o = useLoad(() => api.get<OppDetail>(`/api/v1/opportunities/${id}`), [id]);
  const { session } = useSession();
  const [f, setF] = useState({ title: '', value: '', date: '', owner_id: '' });
  const [act, setAct] = useState({ kind: 'NOTE', body: '', due: '' });
  const [valErr, setValErr] = useState<string | null>(null);
  const save = useCommand();
  const add = useCommand();
  const done = useCommand();
  useEffect(() => { if (o.data) setF({ title: o.data.title, value: centsToInput(o.data.expected_value_cents), date: o.data.expected_purchase_date ?? '', owner_id: o.data.owner_id }); }, [o.data]);
  const d = o.data;
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!d) return;
    const cents = parseMoneyInput(f.value);
    if (cents === undefined) { setValErr('Use o formato 12.900,00.'); return; }
    setValErr(null);
    const body: Record<string, unknown> = { expected_version: d.version };
    if (f.title !== d.title) body.title = f.title;
    if (cents !== d.expected_value_cents) body.expected_value_cents = cents;
    if ((f.date || null) !== d.expected_purchase_date) body.expected_purchase_date = f.date || null;
    if (session?.profile === 'OWNER' && f.owner_id !== d.owner_id) body.owner_id = f.owner_id;
    if (Object.keys(body).length > 1 && (await save.run('PATCH', `/api/v1/opportunities/${d.id}`, body, { success: 'Oportunidade salva.' }))) o.reload();
  }
  async function addActivity(e: FormEvent) {
    e.preventDefault();
    if (!d) return;
    const body: Record<string, unknown> = { kind: act.kind, body: act.body };
    if (act.due) body.due_at = new Date(act.due).toISOString().replace(/\.\d{3}Z$/, 'Z');
    if (await add.run('POST', `/api/v1/opportunities/${d.id}/activities`, body, { success: 'Atividade registrada.' })) { setAct({ kind: 'NOTE', body: '', due: '' }); o.reload(); }
  }
  return (
    <Dialog open title={d?.title ?? 'Oportunidade'} onClose={onClose} wide>
      {o.loading && !d ? <Loading rows={4} /> : o.error || !d ? <ErrorBox error={o.error ?? ''} onRetry={o.reload} /> : (
        <>
          <div className="unit-row">
            <Status tone={d.stage.kind === 'WON' ? 'ok' : d.stage.kind === 'LOST' ? 'danger' : 'info'}>{d.stage.name}</Status>
            <Link to={`/app/contatos/${d.contact_id}`}>{d.contact_name}</Link>
            {d.mobile_phone && <a className="btn btn-sm" href={waLink(d.mobile_phone)} target="_blank" rel="noreferrer"><Icon name="phone" /> {formatPhone(d.mobile_phone)}</a>}
            <span className="subtle">Origem: {d.source === 'landing' ? 'Site' : 'Cadastro manual'}</span>
          </div>
          {d.lost_reason && <div className="alert alert-danger"><strong>Motivo da perda</strong>{d.lost_reason}</div>}
          <form onSubmit={submit} noValidate style={{ display: 'grid', gap: 16 }}>
            <div className="form-grid">
              <Field label="Título">{(p) => <input {...p} className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />}</Field>
              <Field label="Valor potencial" optional help="Não é faturamento." error={valErr ?? (fieldOf(save.error) === 'expected_value_cents' ? describeError(save.error) : null)}>
                {(p) => <input {...p} className="input" inputMode="decimal" placeholder="12.900,00" value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} />}</Field>
              <Field label="Previsão de compra" optional>{(p) => <input {...p} type="date" className="input" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />}</Field>
              {session?.profile === 'OWNER' && <Field label="Responsável">{(p) => <select {...p} className="input" value={f.owner_id} onChange={(e) => setF({ ...f, owner_id: e.target.value })}>
                {owners.filter((u) => u.active || u.id === d.owner_id).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>}</Field>}
            </div>
            <div className="form-actions"><button className="btn btn-primary" disabled={save.busy}>Salvar oportunidade</button></div>
          </form>
          <div className="grid-2">
            <section>
              <h3 style={{ marginBottom: 12 }}>Atividades</h3>
              <form onSubmit={addActivity} style={{ display: 'grid', gap: 12, marginBottom: 16 }}>
                <div className="form-grid">
                  <Field label="Tipo">{(p) => <select {...p} className="input" value={act.kind} onChange={(e) => setAct({ ...act, kind: e.target.value })}>
                    <option value="NOTE">Anotação</option><option value="CALL">Contato registrado</option><option value="TASK">Tarefa</option></select>}</Field>
                  <Field label="Retorno em" optional>{(p) => <input {...p} type="datetime-local" className="input" value={act.due} onChange={(e) => setAct({ ...act, due: e.target.value })} />}</Field>
                </div>
                <Field label="Descrição" error={fieldOf(add.error) === 'body' ? describeError(add.error) : null}>{(p) => <textarea {...p} className="input" value={act.body} onChange={(e) => setAct({ ...act, body: e.target.value })} />}</Field>
                <div className="form-actions"><button className="btn" disabled={add.busy}>Registrar atividade</button></div>
              </form>
              <ul className="timeline">{d.activities.map((a) => (
                <li key={a.id}><span className="dot" /><div>
                  <div style={{ whiteSpace: 'pre-wrap' }}>{a.body}</div>
                  <div className="subtle">{KIND[a.kind]} · {a.author_name} · {formatInstant(a.created_at)}</div>
                  {a.due_at && <div className="unit-row" style={{ marginTop: 4 }}>
                    {a.completed_at ? <Status tone="ok">Concluída</Status> : <Status tone="warn">Retorno {formatInstant(a.due_at)}</Status>}
                    {!a.completed_at && <button className="btn btn-sm" disabled={done.busy} onClick={async () => { if (await done.run('POST', `/api/v1/activities/${a.id}/complete`, undefined)) o.reload(); }}>Concluir</button>}
                  </div>}
                </div></li>))}</ul>
            </section>
            <section>
              <h3 style={{ marginBottom: 12 }}>Histórico</h3>
              <ul className="timeline">{d.history.map((h, i) => (
                <li key={i}><span className="dot" /><div>{HISTORY[h.action]?.(h.details) ?? h.action}
                  <div className="subtle">{h.actor_name ?? 'Sistema'} · {formatInstant(h.occurred_at)}</div></div></li>))}</ul>
              {d.expected_purchase_date && <p className="subtle" style={{ marginTop: 12 }}>Previsão: {formatDateOnly(d.expected_purchase_date)}</p>}
            </section>
          </div>
        </>
      )}
    </Dialog>
  );
}

const HISTORY: Record<string, (d: Record<string, unknown>) => string> = {
  'opportunity.created': (d) => `Criada em ${d.stage}`,
  'opportunity.moved': (d) => `Movida de ${d.from} para ${d.to}${d.loss_reason ? ` — ${d.loss_reason}` : ''}`,
  'opportunity.updated': () => 'Dados atualizados',
};
