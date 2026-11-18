// Adaptador PostgreSQL: o Worker só chama funções do schema api (papel ninebike_api).
// Comandos rodam numa transação única: recibo de idempotência → RPC → gravação do recibo.
import postgres from 'postgres';
import { ApiError, fromDbError } from '../http/errors';

export type Sql = postgres.Sql;

export function createSql(connectionString: string): Sql {
  return postgres(connectionString, { max: 4, fetch_types: false, idle_timeout: 5, connect_timeout: 10, onnotice: () => {} });
}

const FN_NAME = /^[a-z_]+$/;

export type CommandCtx = {
  actor_id: string;
  request_id: string;
  mfa_recent: boolean;
  deploy_id: string | null;
};

export class Db {
  constructor(private sql: Sql) {}

  /** Consulta: api.<fn>(...args). Retorna o JSON da função. */
  async query<T = unknown>(fn: string, args: unknown[]): Promise<T> {
    if (!FN_NAME.test(fn)) throw new Error('invalid fn');
    try {
      const rows = await this.sql.unsafe(`select api.${fn}(${args.map((_, i) => placeholder(args[i], i)).join(', ')}) as r`,
        args.map(serialize) as never[]);
      return rows[0].r as T;
    } catch (e) {
      throw fromDbError(e);
    }
  }

  /**
   * Comando idempotente. Mesma chave + mesmo hash devolve a resposta original sem reexecutar;
   * hash diferente → IDEMPOTENCY_CONFLICT. Falha da RPC desfaz tudo (nenhum recibo é gravado).
   */
  async command(opts: {
    ctx: CommandCtx;
    command: string;
    key: string;
    requestHash: string;
    fn: string;
    args: unknown[]; // após p_ctx
    successStatus: number;
  }): Promise<{ status: number; body: unknown; replayed: boolean }> {
    if (!FN_NAME.test(opts.fn)) throw new Error('invalid fn');
    const { ctx, command, key, requestHash } = opts;
    const fullCtx = { ...ctx, effect_base: `${ctx.actor_id}:${command}:${key}` };
    try {
      return await this.sql.begin(async (tx) => {
        const [{ r: existing }] = await tx.unsafe('select api.receipt_begin($1::uuid, $2, $3::uuid, $4) as r', [
          ctx.actor_id,
          command,
          key,
          requestHash,
        ]);
        if (existing) return { status: existing.status as number, body: existing.body, replayed: true };
        const all = [fullCtx, ...opts.args];
        const rows = await tx.unsafe(
          `select api.${opts.fn}(${all.map((a, i) => placeholder(a, i)).join(', ')}) as r`,
          all.map(serialize) as never[],
        );
        const body = rows[0].r;
        await tx.unsafe('select api.receipt_store($1::uuid, $2, $3::uuid, $4, $5, $6::jsonb)', [
          ctx.actor_id,
          command,
          key,
          requestHash,
          opts.successStatus,
          body as never,
        ]);
        return { status: opts.successStatus, body, replayed: false };
      });
    } catch (e) {
      if (e instanceof ApiError) throw e;
      throw fromDbError(e);
    }
  }

  /** Função sem ator (captura pública de lead). */
  async publicCall<T = unknown>(fn: string, payload: unknown): Promise<T> {
    return this.query<T>(fn, [payload]);
  }
}

function placeholder(v: unknown, i: number): string {
  if (v !== null && typeof v === 'object') return `$${i + 1}::jsonb`;
  if (typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v)) return `$${i + 1}::uuid`;
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return `$${i + 1}::date`;
  return `$${i + 1}`;
}

// O driver conhece o tipo jsonb do parâmetro (::jsonb) e serializa o objeto; não pré-serializar.
function serialize(v: unknown): unknown {
  return v === undefined ? null : v;
}
