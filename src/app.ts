// Composição HTTP /api/v1 (e captura pública). Sem dependência do runtime: recebe as portas prontas.
import { ApiError, fieldError } from './adapters/http/errors';
import { authenticate, type AuthConfig, type Principal } from './adapters/http/auth';
import { Db, type CommandCtx } from './adapters/persistence/db';
import { sniffImage, type AuthAdmin, type FileStorage } from './adapters/providers/supabase';
import * as S from './adapters/http/schemas';
import { date, isUuid, type Parser } from './adapters/http/validate';
import { isSafeWebhookUrl } from './modules/integrations/webhooks';
import { normalizeBrMobile, normalizeCnpj, normalizeEmail } from './modules/crm/contact-rules';

export type AppDeps = {
  db: Db;
  auth: AuthConfig;
  environment: 'local' | 'test' | 'staging' | 'production';
  deployId: string | null;
  storage: FileStorage | null;
  storageBucket: string;
  authAdmin: AuthAdmin | null;
  appOrigin: string;
  devLogin?: (email: string) => Promise<{ access_token: string } | null>;
};

type Ctx = { req: Request; url: URL; params: Record<string, string>; requestId: string; deps: AppDeps };
type Handler = (c: Ctx) => Promise<Response>;
type Route = { method: string; pattern: RegExp; keys: string[]; handler: Handler };

const routes: Route[] = [];
function route(method: string, path: string, handler: Handler) {
  const keys: string[] = [];
  const pattern = new RegExp(
    '^' + path.replace(/\{(\w+)\}/g, (_, k) => (keys.push(k), '([0-9a-fA-F-]{36})')) + '$',
  );
  routes.push({ method, pattern, keys, handler });
}

// ---------------------------------------------------------------- utilidades
const SENSITIVE_HEADERS = { 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8' };

function json(c: Ctx, status: number, body: unknown, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...SENSITIVE_HEADERS, 'x-request-id': c.requestId, ...extra } });
}
const ok = (c: Ctx, data: unknown, status = 200) => json(c, status, { data, request_id: c.requestId });

async function readJson(req: Request): Promise<unknown> {
  const ct = req.headers.get('content-type') ?? '';
  if (!ct.includes('application/json')) throw new ApiError('BAD_REQUEST', { reason: 'content_type_json_required' });
  const text = await req.text();
  if (text.length > 256 * 1024) throw new ApiError('VALIDATION_FAILED', { reason: 'payload_too_large' });
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError('BAD_REQUEST', { reason: 'invalid_json' });
  }
}

function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object')
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
}
export async function sha256Hex(s: string | Uint8Array): Promise<string> {
  const data = typeof s === 'string' ? new TextEncoder().encode(s) : s;
  const h = await crypto.subtle.digest('SHA-256', data as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const principals = new WeakMap<Request, Principal>();
async function principal(c: Ctx): Promise<Principal> {
  let p = principals.get(c.req);
  if (!p) {
    p = await authenticate(c.req, c.deps.auth);
    // Limite geral por usuário (600 req/min): contém abuso de token vazado e scripts descontrolados.
    if (!(await c.deps.db.query<boolean>('rate_hit', [p.userId]))) throw new ApiError('RATE_LIMITED');
    principals.set(c.req, p);
  }
  return p;
}

/** Executa comando autenticado e idempotente: Idempotency-Key UUID obrigatório, hash do comando validado. */
async function command(c: Ctx, name: string, fn: string, args: unknown[], status = 200, transform?: (b: unknown) => unknown) {
  const p = await principal(c);
  const key = c.req.headers.get('idempotency-key');
  if (!key || !isUuid(key)) throw fieldError('Idempotency-Key', 'required_uuid_header');
  const requestHash = await sha256Hex(canonical({ path: c.url.pathname, args }));
  const ctx: CommandCtx = { actor_id: p.userId, request_id: c.requestId, mfa_recent: p.mfaRecent, deploy_id: c.deps.deployId };
  const r = await c.deps.db.command({ ctx, command: name, key: key.toLowerCase(), requestHash, fn, args, successStatus: status });
  const body = transform ? transform(r.body) : r.body;
  return json(c, r.status, { data: body, request_id: c.requestId }, r.replayed ? { 'idempotent-replayed': 'true' } : {});
}

async function q<T = unknown>(c: Ctx, fn: string, args: unknown[] = []): Promise<T> {
  const p = await principal(c);
  return c.deps.db.query<T>(fn, [p.userId, ...args]);
}

async function body<T>(c: Ctx, parser: Parser<T> | ((b: unknown) => T)): Promise<T> {
  const raw = await readJson(c.req);
  return (parser as (v: unknown, path: string) => T)(raw, '');
}

// Cursor opaco: posição + hash dos filtros. Filtro diferente com o mesmo cursor → 400 CURSOR_STALE.
async function encodeCursor(pos: unknown[], filters: unknown) {
  const f = (await sha256Hex(canonical(filters))).slice(0, 16);
  return btoa(JSON.stringify({ p: pos, f })).replace(/=+$/, '');
}
async function decodeCursor(raw: string | null, filters: unknown): Promise<unknown[] | null> {
  if (!raw) return null;
  try {
    const { p, f } = JSON.parse(atob(raw));
    if (f !== (await sha256Hex(canonical(filters))).slice(0, 16)) throw 0;
    if (!Array.isArray(p)) throw 0;
    return p;
  } catch {
    throw new ApiError('CURSOR_STALE');
  }
}
function limitParam(url: URL) {
  const raw = url.searchParams.get('limit');
  if (raw === null) return 50;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 100) throw new ApiError('BAD_REQUEST', { field: 'limit', reason: 'between_1_and_100' });
  return n;
}
function uuidParam(url: URL, name: string) {
  const v = url.searchParams.get(name);
  if (v === null || v === '') return undefined;
  if (!isUuid(v)) throw new ApiError('BAD_REQUEST', { field: name, reason: 'invalid_uuid' });
  return v;
}
const page = (c: Ctx, data: unknown[], next: string | null) =>
  json(c, 200, { data, page: { next_cursor: next, has_more: next !== null }, request_id: c.requestId });

// ---------------------------------------------------------------- sessão e administração
route('GET', '/api/v1/session', async (c) => ok(c, { ...(await q<object>(c, 'session')), mfa_recent: (await principal(c)).mfaRecent }));

route('GET', '/api/v1/followups', async (c) => {
  const d = Number(c.url.searchParams.get('days') ?? 3);
  return ok(c, await q(c, 'followups', [Number.isInteger(d) && d > 0 && d < 365 ? d : 3]));
});
route('GET', '/api/v1/dashboard', async (c) => ok(c, await q(c, 'dashboard')));

route('GET', '/api/v1/admin/users', async (c) => ok(c, await q(c, 'admin_list_users')));

route('POST', '/api/v1/admin/invitations', async (c) => {
  const p = await body(c, S.invitationCreate);
  const email = normalizeEmail(p.email);
  if (!c.deps.authAdmin) throw new ApiError('CAPABILITY_UNAVAILABLE', { reason: 'auth_admin_not_configured' });
  const res = await command(c, 'admin.invitation.create', 'admin_create_invitation', [{ ...p, email }], 201);
  if (res.status === 201 && !res.headers.get('idempotent-replayed')) {
    try {
      await c.deps.authAdmin.inviteUser(email, p.name, `${c.deps.appOrigin}/app`);
    } catch {
      // Convite gravado; envio do e-mail falhou. A pessoa pode reenviar sem duplicar o convite.
      return json(c, 503, { code: 'DEPENDENCY_UNAVAILABLE', message: 'Convite registrado, mas o e-mail não foi enviado. Tente reenviar.',
        details: { invitation_recorded: true }, request_id: c.requestId });
    }
  }
  return res;
});

route('PATCH', '/api/v1/admin/users/{id}/access', async (c) =>
  command(c, 'admin.access.update', 'admin_update_access', [c.params.id, await body(c, S.accessPatch)]));

route('GET', '/api/v1/admin/audit-events', async (c) => {
  const type = c.url.searchParams.get('resource_type') ?? '';
  if (!/^[a-z_]{1,40}$/.test(type)) throw new ApiError('BAD_REQUEST', { field: 'resource_type' });
  return ok(c, await q(c, 'admin_audit_events', [type, uuidParam(c.url, 'resource_id') ?? null]));
});

// ---------------------------------------------------------------- contatos e fornecedores
async function listContacts(c: Ctx, role: 'SUPPLIER' | null) {
  const filters = { q: c.url.searchParams.get('q') ?? null, role: role ?? (c.url.searchParams.get('role') || null),
    owner_id: uuidParam(c.url, 'owner_id') ?? null };
  if (filters.role && !['CUSTOMER', 'SUPPLIER'].includes(filters.role)) throw new ApiError('BAD_REQUEST', { field: 'role' });
  const cur = await decodeCursor(c.url.searchParams.get('cursor'), filters);
  const r = await q<{ data: Array<{ created_at: string; id: string }>; has_more: boolean }>(c, 'contact_list', [{
    ...filters, limit: limitParam(c.url), cursor_created_at: cur?.[0] ?? null, cursor_id: cur?.[1] ?? null }]);
  const last = r.data[r.data.length - 1];
  return page(c, r.data, r.has_more && last ? await encodeCursor([last.created_at, last.id], filters) : null);
}
route('GET', '/api/v1/contacts', (c) => listContacts(c, null));
route('GET', '/api/v1/suppliers', (c) => listContacts(c, 'SUPPLIER'));
route('GET', '/api/v1/contacts/birthdays', async (c) => {
  const from = date(c.url.searchParams.get('from'), 'from');
  const to = date(c.url.searchParams.get('to'), 'to'); // semiaberto
  const last = new Date(Date.parse(`${to}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
  if (last < from) throw fieldError('to', 'must_be_after_from');
  return ok(c, await q(c, 'birthday_list', [from, last]));
});
route('GET', '/api/v1/contacts/{id}', async (c) => ok(c, await q(c, 'contact_get', [c.params.id])));
route('POST', '/api/v1/contacts', async (c) =>
  command(c, 'contact.create', 'contact_create', [await body(c, S.parseContactCreate)], 201));
route('PATCH', '/api/v1/contacts/{id}', async (c) =>
  command(c, 'contact.update', 'contact_update', [c.params.id, await body(c, S.parseContactPatch)]));
route('POST', '/api/v1/contacts/{id}/roles', async (c) =>
  command(c, 'contact.add_role', 'contact_add_role', [c.params.id, await body(c, S.parseAddRole)]));
route('POST', '/api/v1/suppliers', async (c) =>
  command(c, 'supplier.create', 'supplier_create', [await body(c, S.parseSupplierCreate)], 201));

// ---------------------------------------------------------------- pipeline
function boardFilters(c: Ctx) {
  const src = c.url.searchParams.get('source');
  const from = c.url.searchParams.get('created_from');
  const to = c.url.searchParams.get('created_to');
  return {
    q: c.url.searchParams.get('q') || null, owner_id: uuidParam(c.url, 'owner_id') ?? null,
    source: src && /^[a-z_]{1,30}$/.test(src) ? src : null,
    interest_product_id: uuidParam(c.url, 'interest_product_id') ?? null,
    created_from: from ? `${date(from, 'created_from')}T03:00:00Z` : null,
    created_to: to ? `${date(to, 'created_to')}T03:00:00Z` : null,
  };
}
route('GET', '/api/v1/pipeline-stages', async (c) => ok(c, await q(c, 'pipeline_board', [{ ...boardFilters(c), limit: limitParam(c.url) }])));
route('GET', '/api/v1/pipeline-stages/{id}/opportunities', async (c) => {
  const filters = { ...boardFilters(c), stage_id: c.params.id };
  const cur = await decodeCursor(c.url.searchParams.get('cursor'), filters);
  const [stage] = await q<Array<{ cards: Array<{ position: number }>; total: number }>>(c, 'pipeline_board', [
    { ...filters, limit: limitParam(c.url), after_position: cur?.[0] ?? null }]);
  if (!stage) throw new ApiError('NOT_FOUND');
  const last = stage.cards[stage.cards.length - 1];
  const more = last && stage.cards.length === limitParam(c.url);
  return page(c, stage.cards, more ? await encodeCursor([last.position], filters) : null);
});
route('POST', '/api/v1/pipeline-stages', async (c) => command(c, 'stage.create', 'stage_create', [await body(c, S.stageCreate)], 201));
route('POST', '/api/v1/pipeline-stages/reorder', async (c) => command(c, 'stage.reorder', 'stage_reorder', [await body(c, S.stageReorder)]));
route('PATCH', '/api/v1/pipeline-stages/{id}', async (c) =>
  command(c, 'stage.update', 'stage_update', [c.params.id, await body(c, S.stagePatch)]));
route('POST', '/api/v1/pipeline-stages/{id}/archive', async (c) =>
  command(c, 'stage.archive', 'stage_archive', [c.params.id, await body(c, S.stageArchive)]));

route('GET', '/api/v1/opportunities/{id}', async (c) => ok(c, await q(c, 'opportunity_get', [c.params.id])));
route('POST', '/api/v1/opportunities', async (c) =>
  command(c, 'opportunity.create', 'opportunity_create', [await body(c, S.opportunityCreate)], 201));
route('PATCH', '/api/v1/opportunities/{id}', async (c) =>
  command(c, 'opportunity.update', 'opportunity_update', [c.params.id, await body(c, S.opportunityPatch)]));
route('POST', '/api/v1/opportunities/{id}/moves', async (c) =>
  command(c, 'opportunity.move', 'opportunity_move', [c.params.id, await body(c, S.moveOpportunity)]));
route('POST', '/api/v1/opportunities/{id}/activities', async (c) =>
  command(c, 'activity.create', 'activity_create', [c.params.id, await body(c, S.activityCreate)], 201));
route('POST', '/api/v1/activities/{id}/complete', async (c) => command(c, 'activity.complete', 'activity_complete', [c.params.id]));
route('GET', '/api/v1/activities/agenda', async (c) => ok(c, await q(c, 'activity_agenda')));
route('GET', '/api/v1/crm/settings', async (c) => ok(c, await q(c, 'crm_settings')));
route('PATCH', '/api/v1/crm/settings', async (c) => command(c, 'crm.settings', 'crm_settings_update', [await body(c, S.crmSettingsPatch)]));

// ---------------------------------------------------------------- catálogo e estoque
route('GET', '/api/v1/catalog/products', async (c) => {
  const type = c.url.searchParams.get('type');
  const filters = { q: c.url.searchParams.get('q') || null, type: type === 'BIKE' || type === 'ACCESSORY' ? type : null,
    include_archived: c.url.searchParams.get('include_archived') === 'true' };
  const cur = await decodeCursor(c.url.searchParams.get('cursor'), filters);
  const r = await q<{ data: Array<{ name: string; id: string }>; has_more: boolean }>(c, 'product_list', [{
    ...filters, limit: limitParam(c.url), cursor_name: cur?.[0] ?? null, cursor_id: cur?.[1] ?? null }]);
  const last = r.data[r.data.length - 1];
  return page(c, r.data, r.has_more && last ? await encodeCursor([last.name, last.id], filters) : null);
});
route('GET', '/api/v1/catalog/products/{id}', async (c) => ok(c, await q(c, 'product_get', [c.params.id])));
route('POST', '/api/v1/catalog/products', async (c) =>
  command(c, 'product.create', 'product_create', [await body(c, S.parseProductCreate)], 201));
route('PATCH', '/api/v1/catalog/products/{id}', async (c) =>
  command(c, 'product.update', 'product_update', [c.params.id, await body(c, S.parseProductPatch)]));
route('POST', '/api/v1/catalog/products/{id}/archive', async (c) =>
  command(c, 'product.archive', 'product_archive', [c.params.id, await body(c, S.productArchive)]));
route('POST', '/api/v1/inventory/receipts', async (c) =>
  command(c, 'stock.receipt', 'stock_receipt', [await body(c, S.parseStockReceipt)], 201));
route('POST', '/api/v1/inventory/adjustments', async (c) =>
  command(c, 'stock.adjustment', 'stock_adjustment', [await body(c, S.stockAdjustment)], 201));
route('POST', '/api/v1/inventory/recounts', async (c) =>
  command(c, 'stock.recount', 'stock_recount', [await body(c, S.parseStockRecount)], 201));
route('PATCH', '/api/v1/inventory/units/{id}/identification', async (c) =>
  command(c, 'unit.identification', 'unit_identification', [c.params.id, await body(c, S.parseUnitIdentification)]));

// ---------------------------------------------------------------- propostas, reservas e Registro de vendas
route('GET', '/api/v1/commercial-policy', async (c) => ok(c, await q(c, 'policy_get')));
route('POST', '/api/v1/admin/policy-versions', async (c) => command(c, 'policy.create', 'policy_create', [await body(c, S.policyCreate)], 201));
route('GET', '/api/v1/quotes', async (c) => ok(c, await q(c, 'quote_list', [{ opportunity_id: uuidParam(c.url, 'opportunity_id') ?? null, contact_id: uuidParam(c.url, 'contact_id') ?? null }])));
route('GET', '/api/v1/quotes/{id}', async (c) => ok(c, await q(c, 'quote_get', [c.params.id])));
route('POST', '/api/v1/quotes', async (c) => command(c, 'quote.create', 'quote_create', [await body(c, S.quoteCreate)], 201));
route('PATCH', '/api/v1/quotes/{id}', async (c) => command(c, 'quote.revise', 'quote_revise', [c.params.id, await body(c, S.quoteRevision)]));
route('POST', '/api/v1/reservations', async (c) => command(c, 'reservation.create', 'reservation_create', [await body(c, S.reservationCreate)], 201));
route('POST', '/api/v1/quotes/{id}/reservation-release', async (c) => command(c, 'reservation.release', 'reservation_release', [c.params.id]));
route('POST', '/api/v1/orders', async (c) => command(c, 'order.confirm', 'order_confirm', [await body(c, S.orderCreate)], 201));
route('GET', '/api/v1/orders', async (c) => {
  const st = c.url.searchParams.get('state');
  const from = c.url.searchParams.get('from'); const to = c.url.searchParams.get('to');
  const filters = { owner_id: uuidParam(c.url, 'owner_id') ?? null, contact_id: uuidParam(c.url, 'contact_id') ?? null,
    state: st && ['CONFIRMED', 'CANCELLED', 'CLOSED'].includes(st) ? st : null,
    from: from ? `${date(from, 'from')}T03:00:00Z` : null, to: to ? `${date(to, 'to')}T03:00:00Z` : null };
  const cur = await decodeCursor(c.url.searchParams.get('cursor'), filters);
  const r = await q<{ data: Array<{ confirmed_at: string; id: string }>; has_more: boolean; totals: unknown }>(c, 'order_list', [{
    ...filters, limit: limitParam(c.url), cursor_at: cur?.[0] ?? null, cursor_id: cur?.[1] ?? null }]);
  const last = r.data[r.data.length - 1];
  const next = r.has_more && last ? await encodeCursor([last.confirmed_at, last.id], filters) : null;
  return json(c, 200, { data: r.data, totals: r.totals, page: { next_cursor: next, has_more: next !== null }, request_id: c.requestId });
});
route('GET', '/api/v1/orders/{id}', async (c) => ok(c, await q(c, 'order_get', [c.params.id])));
route('POST', '/api/v1/orders/{id}/cancellations', async (c) => command(c, 'order.cancel', 'order_cancel', [c.params.id, await body(c, S.orderCancel)]));
// Entrega e cobrança dependem do recebimento oficial (PSP, T07) — indisponíveis, sem sucesso fictício.
route('POST', '/api/v1/orders/{id}/deliveries', async () => { throw new ApiError('CAPABILITY_UNAVAILABLE', { reason: 'payment_provider_pending' }); });
route('POST', '/api/v1/payments', async () => { throw new ApiError('CAPABILITY_UNAVAILABLE', { reason: 'payment_provider_pending' }); });

// ---------------------------------------------------------------- fiscal: preparo e aprovação humana; transmissão desligada
route('GET', '/api/v1/fiscal-documents', async (c) => {
  const st = c.url.searchParams.get('review_state');
  return ok(c, await q(c, 'fiscal_document_list', [{ review_state: st && /^[A-Z_]{1,30}$/.test(st) ? st : null }]));
});
route('GET', '/api/v1/fiscal-documents/{id}', async (c) => ok(c, await q(c, 'fiscal_document_get', [c.params.id])));
route('POST', '/api/v1/fiscal-documents', async (c) => command(c, 'fiscal.create', 'fiscal_document_create', [await body(c, S.fiscalCreate)], 201));
route('PATCH', '/api/v1/fiscal-documents/{id}/draft', async (c) => command(c, 'fiscal.update', 'fiscal_document_update', [c.params.id, await body(c, S.parseFiscalPatch)]));
route('POST', '/api/v1/fiscal-documents/{id}/validations', async (c) => command(c, 'fiscal.validate', 'fiscal_document_validate', [c.params.id, await body(c, S.fiscalVersion)]));
route('POST', '/api/v1/fiscal-documents/{id}/approvals', async (c) => command(c, 'fiscal.approve', 'fiscal_document_approve', [c.params.id, await body(c, S.fiscalApprove)]));
route('POST', '/api/v1/fiscal-documents/{id}/external-evidence', async (c) => command(c, 'fiscal.evidence', 'fiscal_external_evidence', [c.params.id, await body(c, S.fiscalEvidence)]));
// Envio exige provedor fiscal homologado (modo OS_PRIMARY). Até lá, nunca transmite nem finge autorização.
route('POST', '/api/v1/fiscal-documents/{id}/submit', async () => { throw new ApiError('CAPABILITY_UNAVAILABLE', { reason: 'issuer_not_homologated' }); });
route('GET', '/api/v1/admin/fiscal-configurations', async (c) => ok(c, await q(c, 'fiscal_settings_get')));
route('PATCH', '/api/v1/admin/fiscal-configurations', async (c) => {
  const p = await body(c, S.fiscalSettings);
  const issuer = { ...p.issuer, cnpj: normalizeCnpj(p.issuer.cnpj, 'issuer.cnpj'), state: p.issuer.state.toUpperCase() };
  return command(c, 'fiscal.settings', 'fiscal_settings_update', [{ ...p, issuer }]);
});
route('PATCH', '/api/v1/catalog/products/{id}/ncm', async (c) => {
  const raw = (await readJson(c.req)) as { ncm?: unknown };
  const ncm = typeof raw?.ncm === 'string' ? raw.ncm.replace(/\D/g, '') : '';
  if (!/^\d{8}$/.test(ncm)) throw fieldError('ncm', 'invalid_ncm');
  return command(c, 'product.ncm', 'product_set_ncm', [c.params.id, { ncm }]);
});

// ---------------------------------------------------------------- fotos (bucket privado)
function requireStorage(c: Ctx): FileStorage {
  if (!c.deps.storage) throw new ApiError('CAPABILITY_UNAVAILABLE', { reason: 'storage_not_configured' });
  return c.deps.storage;
}
route('POST', '/api/v1/attachments', async (c) => {
  const storage = requireStorage(c);
  const p = await body(c, S.attachmentCreate);
  const res = await command(c, 'attachment.register', 'file_register', [{ ...p, bucket: c.deps.storageBucket }], 201);
  if (res.status !== 201) return res;
  const { data } = (await res.json()) as { data: { id: string; bucket: string; object_path: string } };
  const signed = await storage.createSignedUpload(data.bucket, data.object_path);
  return ok(c, { id: data.id, state: 'PENDING', upload_url: signed.upload_url, upload_token: signed.token }, 201);
});
route('POST', '/api/v1/attachments/{id}/complete', async (c) => {
  const storage = requireStorage(c);
  const f = await q<{ bucket: string; object_path: string; state: string; declared_content_type: string; declared_size_bytes: number }>(
    c, 'file_get', [c.params.id]);
  let verdict: Record<string, unknown> = { accepted: false };
  if (f.state === 'PENDING') {
    const bytes = await storage.download(f.bucket, f.object_path);
    if (!bytes) throw new ApiError('VALIDATION_FAILED', { reason: 'object_not_uploaded' });
    const kind = sniffImage(bytes);
    const accepted = kind !== null && kind === f.declared_content_type && bytes.length <= 8 * 1024 * 1024;
    verdict = { accepted, content_type: kind, size_bytes: bytes.length, sha256: await sha256Hex(bytes) };
    if (!accepted) await storage.remove(f.bucket, f.object_path);
  }
  const r = await command(c, 'attachment.complete', 'file_complete', [c.params.id, verdict]);
  return r;
});
route('GET', '/api/v1/attachments/{id}/access', async (c) => {
  const storage = requireStorage(c);
  const f = await q<{ bucket: string; object_path: string; state: string }>(c, 'file_get', [c.params.id]);
  if (f.state !== 'READY') throw new ApiError('NOT_FOUND');
  return ok(c, { url: await storage.createSignedRead(f.bucket, f.object_path, 300), expires_in: 300 });
});

// ---------------------------------------------------------------- captura pública
route('POST', '/public/v1/lead-submissions', async (c) => {
  const p = await body(c, S.leadSubmission);
  const ip = c.req.headers.get('cf-connecting-ip') ?? '';
  const requestHash = await sha256Hex(canonical(p));
  const clientHash = ip ? (await sha256Hex(`lead:${ip}`)).slice(0, 32) : null;
  const r = await c.deps.db.publicCall<{ submission_id: string; replayed: boolean }>('lead_submit', {
    ...p, request_hash: requestHash, client_hash: clientHash });
  return json(c, r.replayed ? 200 : 201, { data: { submission_id: r.submission_id }, request_id: c.requestId });
});

// ---------------------------------------------------------------- comissão da equipe (T16)
route('GET', '/api/v1/staff-commissions/rule', async (c) => ok(c, await q(c, 'staff_commission_rule_get')));
route('POST', '/api/v1/admin/staff-commission-rules', async (c) => {
  const p = await body(c, S.staffCommissionRule);
  const overrides = Object.fromEntries((p.overrides ?? []).map((o) => [o.profile_id.toLowerCase(), o.bps]));
  return command(c, 'staff_commission.rule', 'staff_commission_rule_create', [{ ...p, overrides }], 201);
});
route('GET', '/api/v1/staff-commissions', async (c) => {
  const from = c.url.searchParams.get('from'); const to = c.url.searchParams.get('to');
  return ok(c, await q(c, 'staff_commission_statement', [{ seller_id: uuidParam(c.url, 'seller_id') ?? null,
    from: from ? `${date(from, 'from')}T03:00:00Z` : null, to: to ? `${date(to, 'to')}T03:00:00Z` : null }]));
});
route('POST', '/api/v1/staff-commissions/payments', async (c) =>
  command(c, 'staff_commission.paid', 'staff_commission_mark_paid', [await body(c, S.staffCommissionPaid)]));

// ---------------------------------------------------------------- T10 despesas e resultado gerencial (OWNER)
route('GET', '/api/v1/expense-categories', async (c) => ok(c, await q(c, 'expense_categories')));
route('GET', '/api/v1/expenses', async (c) => {
  const st = c.url.searchParams.get('status'); const from = c.url.searchParams.get('from'); const to = c.url.searchParams.get('to');
  return ok(c, await q(c, 'expense_list', [{ status: st && ['OPEN', 'OVERDUE', 'PAID', 'PARTIAL', 'CANCELLED'].includes(st) ? st : null,
    from: from ? date(from, 'from') : null, to: to ? date(to, 'to') : null, category_id: uuidParam(c.url, 'category_id') ?? null }]));
});
route('POST', '/api/v1/expenses', async (c) => command(c, 'expense.create', 'expense_create', [await body(c, S.expenseCreate)], 201));
route('POST', '/api/v1/expenses/{id}/cancellations', async (c) => command(c, 'expense.cancel', 'expense_cancel', [c.params.id, await body(c, S.expenseCancel)]));
route('POST', '/api/v1/expenses/{id}/payments', async (c) => command(c, 'expense.pay', 'expense_pay', [c.params.id, await body(c, S.expensePay)], 201));
route('POST', '/api/v1/expense-payments/{id}/reversals', async (c) => command(c, 'expense.reverse', 'expense_payment_reverse', [c.params.id, await body(c, S.expenseReverse)]));
route('GET', '/api/v1/reports/management-result', async (c) => ok(c, await q(c, 'management_result', [date(c.url.searchParams.get('month'), 'month')])));

// ---------------------------------------------------------------- IA do WhatsApp (n8n): chaves e rotas /agent/v1
route('GET', '/api/v1/admin/agent-clients', async (c) => ok(c, await q(c, 'agent_client_list')));
route('POST', '/api/v1/admin/agent-clients', async (c) => {
  const p = await body(c, S.agentClientCreate);
  // O segredo nasce no Worker e nunca vai ao banco nem ao recibo: só o hash. Reenvio com a mesma chave
  // de idempotência não devolve o segredo de novo (o OWNER revoga e cria outra).
  const raw = new Uint8Array(32); crypto.getRandomValues(raw);
  const token = 'nbk_' + btoa(String.fromCharCode(...raw)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const res = await command(c, 'agent_client.create', 'agent_client_create',
    [{ name: p.name.trim(), scopes: p.scopes, allowed_ips: p.allowed_ips ?? [], expires_in_days: p.expires_in_days ?? null, token_hash: await sha256Hex(token), token_prefix: token.slice(0, 10) }], 201);
  if (res.headers.get('idempotent-replayed')) return res;
  const { data } = (await res.json()) as { data: Record<string, unknown> };
  return ok(c, { ...data, token }, 201);
});
route('POST', '/api/v1/admin/agent-clients/{id}/revoke', async (c) => command(c, 'agent_client.revoke', 'agent_client_revoke', [c.params.id]));

async function agentToken(c: Ctx): Promise<string> {
  const h = c.req.headers.get('authorization') ?? '';
  const m = /^Bearer (nbk_[A-Za-z0-9_-]{20,100})$/.exec(h);
  if (!m) throw new ApiError('AUTH_REQUIRED');
  // IP só do cabeçalho que a Cloudflare define na borda (o cliente não consegue forjá-lo atrás do proxy).
  const ip = (c.req.headers.get('cf-connecting-ip') ?? '').trim().toLowerCase();
  return (await sha256Hex(m[1])) + (/^[0-9a-f.:]{3,45}$/.test(ip) ? `@${ip}` : '');
}
/** Celular vindo do WhatsApp: aceita JID (5511999998888@s.whatsapp.net) e o formato antigo sem o nono dígito. */
export function agentPhone(raw: string, path: string): string {
  let d = raw.split('@')[0].replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('55') && /[6-9]/.test(d[4])) d = d.slice(0, 4) + '9' + d.slice(4);
  return normalizeBrMobile(d, path);
}
const aq = async (c: Ctx, fn: string, args: unknown[]) => c.deps.db.query(fn, [await agentToken(c), ...args]);

route('GET', '/agent/v1/products', async (c) => {
  const type = c.url.searchParams.get('type');
  const lim = Number(c.url.searchParams.get('limit') ?? 10);
  return ok(c, await aq(c, 'agent_products_search', [{ q: (c.url.searchParams.get('q') ?? '').slice(0, 100) || null,
    type: type === 'BIKE' || type === 'ACCESSORY' ? type : null, limit: Number.isInteger(lim) ? lim : 10,
    only_available: c.url.searchParams.get('only_available') === 'true' }]));
});
route('GET', '/agent/v1/products/{id}', async (c) => ok(c, await aq(c, 'agent_product_get', [c.params.id])));
route('GET', '/agent/v1/customers/by-phone', async (c) => {
  const phone = agentPhone(c.url.searchParams.get('phone') ?? '', 'phone');
  return ok(c, await aq(c, 'agent_customer_by_phone', [phone]));
});
route('POST', '/agent/v1/leads', async (c) => {
  const p = await body(c, S.agentLead);
  const mobile = agentPhone(p.mobile_phone, 'mobile_phone');
  const args = { event_id: p.event_id.toLowerCase(), name: p.name.trim(), mobile_e164: mobile, note: p.note ?? null,
    interest_product_id: p.interest_product_id ?? null };
  const r = await aq(c, 'agent_lead_upsert', [{ ...args, request_hash: await sha256Hex(canonical(args)) }]) as { replayed: boolean };
  return ok(c, r, r.replayed ? 200 : 201);
});

// ---------------------------------------------------------------- webhooks de saída (n8n etc.)
route('GET', '/api/v1/admin/webhooks', async (c) => ok(c, await q(c, 'webhook_list')));
route('POST', '/api/v1/admin/webhooks', async (c) => {
  const p = await body(c, S.webhookCreate);
  if (!isSafeWebhookUrl(p.url)) throw fieldError('url', 'https_public_url_required');
  const raw = new Uint8Array(32); crypto.getRandomValues(raw);
  const secret = 'whsec_' + [...raw].map((b) => b.toString(16).padStart(2, '0')).join('');
  const res = await command(c, 'webhook.create', 'webhook_create', [{ name: p.name.trim(), url: p.url, events: p.events, secret }], 201);
  if (res.headers.get('idempotent-replayed')) return res;
  const { data } = (await res.json()) as { data: Record<string, unknown> };
  return ok(c, { ...data, secret }, 201);
});
route('POST', '/api/v1/admin/webhooks/{id}/active', async (c) =>
  command(c, 'webhook.active', 'webhook_set_active', [c.params.id, await body(c, S.webhookActive)]));

// ---------------------------------------------------------------- desenvolvimento local
route('POST', '/api/v1/dev/login', async (c) => {
  if (c.deps.environment !== 'local' || !c.deps.devLogin) throw new ApiError('NOT_FOUND');
  const raw = (await readJson(c.req)) as { email?: unknown };
  if (typeof raw?.email !== 'string') throw fieldError('email', 'required');
  const r = await c.deps.devLogin(normalizeEmail(raw.email));
  if (!r) throw new ApiError('PERMISSION_DENIED', { reason: 'no_profile_for_email' });
  return ok(c, r);
});

// ---------------------------------------------------------------- despacho
export function createApp(deps: AppDeps) {
  return async function handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const requestId = crypto.randomUUID();
    const base: Ctx = { req, url, params: {}, requestId, deps };
    let methodMismatch = false;
    for (const r of routes) {
      const m = r.pattern.exec(url.pathname);
      if (!m) continue;
      if (r.method !== req.method) {
        methodMismatch = true;
        continue;
      }
      const params = Object.fromEntries(r.keys.map((k, i) => [k, m[i + 1].toLowerCase()]));
      try {
        return await r.handler({ ...base, params });
      } catch (e) {
        return errorResponse(base, e);
      }
    }
    return errorResponse(base, methodMismatch ? new ApiError('BAD_REQUEST', { reason: 'method_not_allowed' }) : new ApiError('NOT_FOUND'));
  };
}

function errorResponse(c: Ctx, e: unknown) {
  const err = e instanceof ApiError ? e : new ApiError('INTERNAL_ERROR');
  if (!(e instanceof ApiError)) console.error('unhandled', c.requestId, (e as Error)?.message);
  const extra: Record<string, string> = err.code === 'RATE_LIMITED' ? { 'retry-after': '60' } : {};
  return json(c, err.status, { code: err.code, message: err.message, details: err.details, request_id: c.requestId }, extra);
}
