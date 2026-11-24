// Regras puras do cadastro: celular BR normalizado, CPF/CNPJ com dígito, e-mail simples, aniversário civil.
import { fieldError } from '../../adapters/http/errors.js';

/** Normaliza celular brasileiro para E.164 (+55DD9XXXXXXXX). Aceita máscara, DDI opcional e zero de operadora não. */
export function normalizeBrMobile(input: string, path = 'mobile_phone'): string {
  let digits = input.replace(/\D/g, '');
  if (digits.length === 13 && digits.startsWith('55')) digits = digits.slice(2);
  if (digits.length === 11 && /^[1-9]{2}9\d{8}$/.test(digits)) return `+55${digits}`;
  throw fieldError(path, 'invalid_br_mobile');
}

export function normalizeCpf(input: string, path = 'cpf'): string {
  const d = input.replace(/\D/g, '');
  if (!isValidCpf(d)) throw fieldError(path, 'invalid_cpf');
  return d;
}

export function isValidCpf(d: string): boolean {
  if (!/^\d{11}$/.test(d) || /^(\d)\1{10}$/.test(d)) return false;
  const calc = (len: number) => {
    let s = 0;
    for (let i = 0; i < len; i++) s += Number(d[i]) * (len + 1 - i);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return calc(9) === Number(d[9]) && calc(10) === Number(d[10]);
}

export function normalizeCnpj(input: string, path = 'cnpj'): string {
  const d = input.replace(/\D/g, '');
  if (!isValidCnpj(d)) throw fieldError(path, 'invalid_cnpj');
  return d;
}

export function isValidCnpj(d: string): boolean {
  if (!/^\d{14}$/.test(d) || /^(\d)\1{13}$/.test(d)) return false;
  const calc = (len: number) => {
    const w = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let s = 0;
    for (let i = 0; i < len; i++) s += Number(d[i]) * w[i];
    return s % 11 < 2 ? 0 : 11 - (s % 11);
  };
  return calc(12) === Number(d[12]) && calc(13) === Number(d[13]);
}

export function normalizeEmail(input: string, path = 'email'): string {
  const e = input.trim().toLowerCase();
  if (e.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw fieldError(path, 'invalid_email');
  return e;
}

export type Birthday = { day: number; month: number; year?: number | null };

/** Dia/mês obrigatórios juntos; ano opcional. Sem ano valida em ano bissexto de referência (29/02 válido). */
export function validateBirthday(b: Birthday, todayIso: string, path = 'birthday') {
  const { day, month } = b;
  const year = b.year ?? null;
  if (!Number.isInteger(day) || !Number.isInteger(month) || month < 1 || month > 12 || day < 1) throw fieldError(path, 'invalid_date');
  const refYear = year ?? 2000;
  const dt = new Date(Date.UTC(refYear, month - 1, day));
  if (dt.getUTCMonth() !== month - 1) throw fieldError(path, 'invalid_date');
  if (year !== null) {
    if (!Number.isInteger(year) || year < 1900) throw fieldError(path, 'invalid_year');
    const iso = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (iso > todayIso) throw fieldError(path, 'future_date');
  }
  return { birthday_day: day, birthday_month: month, birthday_year: year };
}

/** Data civil de hoje em America/Sao_Paulo (YYYY-MM-DD). */
export function todayInSaoPaulo(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export function normalizeSerial(input: string, path = 'serial_number'): string {
  const s = input.toUpperCase().replace(/\s+/g, '');
  if (!/^[A-Z0-9./-]{3,60}$/.test(s)) throw fieldError(path, 'invalid_serial');
  return s;
}

/** Celular vindo de planilha/WhatsApp: aceita DDI, JID e o formato antigo sem o nono dígito. */
export function normalizeLooseMobile(raw: string, path = 'mobile_phone'): string {
  let d = raw.split('@')[0].replace(/\D/g, '');
  if (d.startsWith('0')) d = d.replace(/^0+/, '');
  if (d.length === 12 && d.startsWith('55') && /[6-9]/.test(d[4])) d = d.slice(0, 4) + '9' + d.slice(4);
  if (d.length === 10 && /[6-9]/.test(d[2])) d = d.slice(0, 2) + '9' + d.slice(2);
  return normalizeBrMobile(d, path);
}

/** Data de nascimento em dd/mm/aaaa, dd/mm, dd-mm-aaaa ou aaaa-mm-dd. */
export function parseBirthdayText(raw: string, path = 'birthday'): { day: number; month: number; year: number | null } {
  const s = raw.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return { day: +m[3], month: +m[2], year: +m[1] };
  m = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?$/.exec(s);
  if (!m) throw fieldError(path, 'invalid_date');
  let year: number | null = m[3] ? +m[3] : null;
  if (year !== null && year < 100) year += year > 30 ? 1900 : 2000;
  return { day: +m[1], month: +m[2], year };
}
