// Validação de payload fechado: campo desconhecido → 422; omitido ≠ null; dinheiro só como string de centavos.
import { fieldError } from './errors.js';

export type Parser<T> = (value: unknown, path: string) => T;
type Field<T> = { parse: Parser<T>; optional: boolean };
type Shape = Record<string, Field<unknown>>;
type Out<S extends Shape> = { [K in keyof S as S[K]['optional'] extends true ? never : K]: ReturnType<S[K]['parse']> } & {
  [K in keyof S as S[K]['optional'] extends true ? K : never]?: ReturnType<S[K]['parse']>;
};

export const req = <T>(parse: Parser<T>): { parse: Parser<T>; optional: false } => ({ parse, optional: false });
export const opt = <T>(parse: Parser<T>): { parse: Parser<T>; optional: true } => ({ parse, optional: true });

export function object<S extends Shape>(shape: S): Parser<Out<S>> {
  return (value, path) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw fieldError(path || 'body', 'must_be_object');
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      if (!(key in shape)) throw fieldError(join(path, key), 'unknown_field');
    }
    for (const [key, field] of Object.entries(shape)) {
      const has = Object.prototype.hasOwnProperty.call(value, key);
      if (!has) {
        if (!field.optional) throw fieldError(join(path, key), 'required');
        continue;
      }
      out[key] = field.parse((value as Record<string, unknown>)[key], join(path, key));
    }
    return out as Out<S>;
  };
}

const join = (a: string, b: string) => (a ? `${a}.${b}` : b);

export const nullable =
  <T>(p: Parser<T>): Parser<T | null> =>
  (v, path) =>
    v === null ? null : p(v, path);

export const string =
  (opts: { max?: number; min?: number; trim?: boolean } = {}): Parser<string> =>
  (v, path) => {
    if (typeof v !== 'string') throw fieldError(path, 'must_be_string');
    const s = opts.trim === false ? v : v.trim();
    if (s.length < (opts.min ?? 0)) throw fieldError(path, opts.min === 1 ? 'required' : 'too_short');
    if (s.length > (opts.max ?? 500)) throw fieldError(path, 'too_long');
    return s;
  };

/** Texto opcional: null, vazio ou só espaços viram null. */
export const optionalText =
  (max = 500): Parser<string | null> =>
  (v, path) => {
    if (v === null) return null;
    const s = string({ max })(v, path);
    return s === '' ? null : s;
  };

export const enumOf =
  <T extends string>(...values: T[]): Parser<T> =>
  (v, path) => {
    if (typeof v !== 'string' || !values.includes(v as T)) throw fieldError(path, 'invalid_value', { allowed: values });
    return v as T;
  };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);
export const uuid: Parser<string> = (v, path) => {
  if (!isUuid(v)) throw fieldError(path, 'invalid_uuid');
  return v.toLowerCase();
};

export const int =
  (opts: { min?: number; max?: number } = {}): Parser<number> =>
  (v, path) => {
    if (typeof v !== 'number' || !Number.isSafeInteger(v)) throw fieldError(path, 'must_be_integer');
    if (opts.min !== undefined && v < opts.min) throw fieldError(path, 'too_small', { min: opts.min });
    if (opts.max !== undefined && v > opts.max) throw fieldError(path, 'too_large', { max: opts.max });
    return v;
  };
export const positiveInt = int({ min: 1, max: 2_147_483_647 });
export const nonNegativeInt = int({ min: 0, max: 2_147_483_647 });

/** MoneyCents: string decimal sem sinal/zeros à esquerda; limite de R$ 10 bilhões evita overflow de BIGINT em somas. */
export const moneyCents: Parser<string> = (v, path) => {
  if (typeof v !== 'string' || !/^(0|[1-9][0-9]*)$/.test(v)) throw fieldError(path, 'invalid_money_cents');
  if (v.length > 15) throw fieldError(path, 'too_large');
  return v;
};

export const date: Parser<string> = (v, path) => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw fieldError(path, 'invalid_date');
  const [y, m, d] = v.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) throw fieldError(path, 'invalid_date');
  return v;
};

export const instant: Parser<string> = (v, path) => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?Z$/.test(v) || Number.isNaN(Date.parse(v)))
    throw fieldError(path, 'invalid_instant');
  return v;
};

export const boolTrue: Parser<true> = (v, path) => {
  if (v !== true) throw fieldError(path, 'must_be_true');
  return true;
};

export const boolean: Parser<boolean> = (v, path) => {
  if (typeof v !== 'boolean') throw fieldError(path, 'must_be_boolean');
  return v;
};

export const array =
  <T>(p: Parser<T>, opts: { max?: number; min?: number } = {}): Parser<T[]> =>
  (v, path) => {
    if (!Array.isArray(v)) throw fieldError(path, 'must_be_array');
    if (v.length > (opts.max ?? 100)) throw fieldError(path, 'too_many');
    if (v.length < (opts.min ?? 0)) throw fieldError(path, 'too_few');
    return v.map((x, i) => p(x, `${path}[${i}]`));
  };

export function parseBody<T>(parser: Parser<T>, body: unknown): T {
  return parser(body, '');
}
