// Cliente da API: bearer da sessão da aba, Idempotency-Key estável por intenção e erros do contrato.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL ?? import.meta.env.NEXT_PUBLIC_SUPABASE_URL) as string | undefined;
const SUPABASE_ANON = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? import.meta.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) as string | undefined;

/** Supabase Auth oficial com sessão em sessionStorage (por aba). Ausente em dev local → login de desenvolvimento. */
export const supabase: SupabaseClient | null =
  SUPABASE_URL && SUPABASE_ANON
    ? createClient(SUPABASE_URL, SUPABASE_ANON, { auth: { storage: window.sessionStorage, persistSession: true, autoRefreshToken: true } })
    : null;
export const devAuth = !supabase;
const DEV_TOKEN = 'nb-dev-token';

export async function accessToken(): Promise<string | null> {
  if (supabase) return (await supabase.auth.getSession()).data.session?.access_token ?? null;
  try {
    return sessionStorage.getItem(DEV_TOKEN);
  } catch {
    return null;
  }
}
export function setDevToken(t: string | null) {
  try {
    if (t) sessionStorage.setItem(DEV_TOKEN, t);
    else sessionStorage.removeItem(DEV_TOKEN);
  } catch {
    /* sessão só em memória */
  }
}

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string, public details: Record<string, unknown> = {}) {
    super(message);
  }
}

export type Page<T> = { data: T[]; page: { next_cursor: string | null; has_more: boolean } };

let onAuthLost: () => void = () => {};
export const setOnAuthLost = (fn: () => void) => (onAuthLost = fn);

async function request<T>(method: string, path: string, body?: unknown, key?: string): Promise<{ data: T } & Record<string, unknown>> {
  const headers: Record<string, string> = { accept: 'application/json' };
  const token = await accessToken();
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (key) headers['idempotency-key'] = key;
  let res: Response;
  try {
    res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new HttpError(0, 'NETWORK', 'Sem conexão com o servidor. Nada foi confirmado; tente de novo.');
  }
  const text = await res.text();
  let json: Record<string, any> = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    // Resposta não-JSON (ex.: falha da função na Vercel): mostra o status em vez de falhar em silêncio.
    throw new HttpError(res.status, 'INTERNAL_ERROR', `Servidor respondeu ${res.status} (${res.headers.get('x-vercel-error') ?? 'sem detalhe'}). Veja os logs do deploy.`);
  }
  if (!res.ok) {
    if (res.status === 401) onAuthLost();
    throw new HttpError(res.status, json.code ?? 'INTERNAL_ERROR', json.message ?? 'Erro inesperado.', json.details ?? {});
  }
  return json as { data: T } & Record<string, unknown>;
}

export const api = {
  get: async <T>(path: string) => (await request<T>('GET', path)).data,
  page: async <T>(path: string) => (await request<T[]>('GET', path)) as unknown as Page<T>,
  /** Comando: reusa a mesma chave em retentativas da mesma intenção (rede caiu → servidor devolve o resultado original). */
  send: async <T>(method: 'POST' | 'PATCH', path: string, body: unknown, key: string) => {
    try {
      return (await request<T>(method, path, body, key)).data;
    } catch (e) {
      if (e instanceof HttpError && e.status === 0) return (await request<T>(method, path, body, key)).data; // uma retentativa segura
      throw e;
    }
  },
  publicPost: async <T>(path: string, body: unknown) => (await request<T>('POST', path, body)).data,
};

export const newKey = () => crypto.randomUUID();

const FIELD_LABELS: Record<string, string> = {
  name: 'Nome', mobile_phone: 'Celular', cpf: 'CPF', cnpj: 'CNPJ', email: 'E-mail', birthday: 'Aniversário',
  person_type: 'Tipo de pessoa', loss_reason: 'Motivo da perda', serial_number: 'Número de série', sku: 'SKU',
  sale_price_cents: 'Preço', unit_ids: 'Unidades', observed_unit_ids: 'Unidades contadas', initial_units: 'Séries',
};
const REASONS: Record<string, string> = {
  required: 'é obrigatório', invalid_br_mobile: 'deve ser um celular brasileiro com DDD', invalid_cpf: 'é inválido',
  invalid_cnpj: 'é inválido', invalid_email: 'é inválido', invalid_date: 'não é uma data válida', future_date: 'não pode ser no futuro',
  duplicate: 'já está em uso', must_identify_each_unit: 'precisa identificar cada bike', required_valid_br_mobile: 'deve ser um celular válido',
  required_for_supplier: 'é obrigatório para fornecedor', must_list_counted_units: 'precisa marcar exatamente as bikes contadas',
  stage_not_empty: 'Mova as oportunidades antes de arquivar a etapa.', last_stage_of_kind: 'A etapa é a última do seu tipo.',
  last_active_owner: 'Não é possível remover o último proprietário ativo.', opening_not_confirmed: 'A abertura de estoque não foi confirmada.',
  product_archived: 'Produto arquivado.', already_member: 'já pertence à equipe',
};

/** Mensagem humana a partir do erro estável do contrato. */
export function describeError(e: unknown): string {
  if (!(e instanceof HttpError)) return 'Erro inesperado.';
  const f = e.details.field as string | undefined;
  const r = e.details.reason as string | undefined;
  if (e.code === 'VALIDATION_FAILED' && f) return `${FIELD_LABELS[f] ?? f} ${REASONS[r ?? ''] ?? 'é inválido'}.`;
  if (r && REASONS[r] && REASONS[r].endsWith('.')) return REASONS[r];
  return e.message;
}

export const fieldOf = (e: unknown) => (e instanceof HttpError ? (e.details.field as string | undefined) : undefined);
