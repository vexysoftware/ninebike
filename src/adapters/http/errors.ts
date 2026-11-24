export const ERROR_STATUS = {
  VALIDATION_FAILED: 422,
  BAD_REQUEST: 400,
  CURSOR_STALE: 400,
  AUTH_REQUIRED: 401,
  PERMISSION_DENIED: 403,
  MFA_RECENCY_REQUIRED: 403,
  NOT_FOUND: 404,
  VERSION_CONFLICT: 409,
  RESERVATION_CONFLICT: 409,
  IDEMPOTENCY_CONFLICT: 409,
  OPERATION_IN_PROGRESS: 409,
  APPROVAL_REQUIRED: 409,
  RATE_LIMITED: 429,
  CAPABILITY_UNAVAILABLE: 503,
  DEPENDENCY_UNAVAILABLE: 503,
  INTERNAL_ERROR: 500,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;

const MESSAGES: Record<ErrorCode, string> = {
  VALIDATION_FAILED: 'Dados inválidos.',
  BAD_REQUEST: 'Requisição malformada.',
  CURSOR_STALE: 'Cursor inválido para estes filtros.',
  AUTH_REQUIRED: 'Sessão inválida ou expirada.',
  PERMISSION_DENIED: 'Ação não permitida para o seu perfil.',
  MFA_RECENCY_REQUIRED: 'Confirme o segundo fator para continuar.',
  NOT_FOUND: 'Registro não encontrado.',
  VERSION_CONFLICT: 'O registro mudou desde que foi aberto. Recarregue e tente de novo.',
  RESERVATION_CONFLICT: 'Estoque ou unidade indisponível para esta operação.',
  IDEMPOTENCY_CONFLICT: 'Esta chave de envio já foi usada com outro conteúdo.',
  OPERATION_IN_PROGRESS: 'Já existe uma operação em andamento para este item.',
  APPROVAL_REQUIRED: 'Precisa de aprovação do proprietário.',
  RATE_LIMITED: 'Muitas tentativas. Aguarde um pouco.',
  CAPABILITY_UNAVAILABLE: 'Recurso ainda não habilitado neste ambiente.',
  DEPENDENCY_UNAVAILABLE: 'Serviço dependente indisponível no momento.',
  INTERNAL_ERROR: 'Erro interno.',
};

export class ApiError extends Error {
  constructor(public code: ErrorCode, public details: Record<string, unknown> = {}, message?: string) {
    super(message ?? MESSAGES[code]);
  }
  get status(): number {
    return ERROR_STATUS[this.code];
  }
}

export const fieldError = (field: string, reason: string, extra: Record<string, unknown> = {}) =>
  new ApiError('VALIDATION_FAILED', { field, reason, ...extra });

/** Traduz erros do PostgreSQL (NB:<CODE> levantado pelas RPCs, ou constraints) para o contrato. */
export function fromDbError(e: unknown): ApiError {
  const err = e as { message?: string; detail?: string; code?: string; constraint_name?: string };
  const msg = err?.message ?? '';
  if (msg.startsWith('NB:')) {
    const code = msg.slice(3) as ErrorCode;
    let details: Record<string, unknown> = {};
    try {
      details = err.detail ? JSON.parse(err.detail) : {};
    } catch {
      details = {};
    }
    return new ApiError(code in ERROR_STATUS ? code : 'INTERNAL_ERROR', details);
  }
  if (err?.code === '23514' || err?.code === '23502' || err?.code === '22P02' || err?.code === '22003')
    return new ApiError('VALIDATION_FAILED', { constraint: err.constraint_name ?? null });
  if (err?.code === '23505') return new ApiError('VALIDATION_FAILED', { reason: 'duplicate', constraint: err.constraint_name ?? null });
  if (err?.code === '23503') return new ApiError('VALIDATION_FAILED', { reason: 'reference_not_found', constraint: err.constraint_name ?? null });
  if (err?.code === '40P01' || err?.code === '40001') return new ApiError('VERSION_CONFLICT', { reason: 'concurrent_update' });
  // Falha de conexão/autenticação no banco: expõe só o código técnico (sem mensagem/credenciais) para diagnóstico.
  const c = String(err?.code ?? '');
  console.error('db', c, msg.slice(0, 200));
  if (/^(28P01|28000|3D000|08\w{3}|57P0\d|53300|XX000|E[A-Z]+|CONNECT_TIMEOUT|CONNECTION_\w+)$/.test(c))
    return new ApiError('DEPENDENCY_UNAVAILABLE', { reason: `db_${c}` });
  return new ApiError('INTERNAL_ERROR', c ? { reason: `db_${c}` } : {});
}
