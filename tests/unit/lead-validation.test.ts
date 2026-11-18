import { describe, expect, it } from 'vitest';
import { parseContactCreate, parseContactPatch, parseProductCreate } from '../../src/adapters/http/schemas';
import { isValidCnpj, isValidCpf, normalizeBrMobile, validateBirthday } from '../../src/modules/crm/contact-rules';
import { ApiError } from '../../src/adapters/http/errors';

const err = (fn: () => unknown) => {
  try { fn(); } catch (e) { return (e as ApiError).details; }
  throw new Error('expected error');
};

describe('cadastro simples de lead (CRM-05)', () => {
  it('nome + celular bastam; opcionais omitidos não aparecem', () => {
    expect(parseContactCreate({ name: '  João da Silva Júnior ', mobile_phone: '(11) 98765-4321' }))
      .toEqual({ name: 'João da Silva Júnior', mobile_e164: '+5511987654321' });
  });
  it('CPF/e-mail/observação vazios ou só espaços viram null', () => {
    expect(parseContactCreate({ name: 'Ana', mobile_phone: '11987654321', cpf: '  ', email: '', notes: ' ' }))
      .toMatchObject({ cpf: null, email: null, note: null });
  });
  it('dado opcional preenchido e inválido é rejeitado com campo', () => {
    expect(err(() => parseContactCreate({ name: 'Ana', mobile_phone: '11987654321', cpf: '123.456.789-00' }))).toMatchObject({ field: 'cpf' });
    expect(err(() => parseContactCreate({ name: 'Ana', mobile_phone: '11987654321', email: 'ana@' }))).toMatchObject({ field: 'email' });
  });
  it('nome vazio, celular ausente/inválido e campo desconhecido falham', () => {
    expect(err(() => parseContactCreate({ name: '  ', mobile_phone: '11987654321' }))).toMatchObject({ field: 'name' });
    expect(err(() => parseContactCreate({ name: 'Ana' }))).toMatchObject({ field: 'mobile_phone', reason: 'required' });
    expect(err(() => parseContactCreate({ name: 'Ana', mobile_phone: '1133334444' }))).toMatchObject({ reason: 'invalid_br_mobile' });
    expect(err(() => parseContactCreate({ name: 'Ana', mobile_phone: '11987654321', owner_id: 'x' }))).toMatchObject({ reason: 'unknown_field' });
  });
  it('PATCH omitido preserva; null limpa opcional', () => {
    expect(parseContactPatch({ expected_version: 3, notes: 'oi' })).toEqual({ expected_version: 3, note: 'oi' });
    expect(parseContactPatch({ expected_version: 3, email: null, cpf: null })).toEqual({ expected_version: 3, email: null, cpf: null });
  });
  it('celular com DDI e máscara normaliza', () => {
    expect(normalizeBrMobile('+55 (21) 9 9999-1234')).toBe('+5521999991234');
  });
});

describe('documentos', () => {
  it('CPF e CNPJ com dígito verificador', () => {
    expect(isValidCpf('52998224725')).toBe(true);
    expect(isValidCpf('52998224724')).toBe(false);
    expect(isValidCpf('11111111111')).toBe(false);
    expect(isValidCnpj('11222333000181')).toBe(true);
    expect(isValidCnpj('11222333000180')).toBe(false);
  });
});

describe('aniversário opcional (LOJ-42/43)', () => {
  const today = '2026-11-18';
  it('29/02 sem ano é válido; 31/04 inválido; nascimento futuro inválido', () => {
    expect(validateBirthday({ day: 29, month: 2 }, today)).toEqual({ birthday_day: 29, birthday_month: 2, birthday_year: null });
    expect(() => validateBirthday({ day: 31, month: 4 }, today)).toThrow();
    expect(() => validateBirthday({ day: 29, month: 2, year: 2023 }, today)).toThrow();
    expect(() => validateBirthday({ day: 1, month: 12, year: 2026 }, today)).toThrow();
    expect(validateBirthday({ day: 18, month: 11, year: 2000 }, today).birthday_year).toBe(2000);
  });
});

describe('produto', () => {
  it('BIKE por padrão; séries devem corresponder à quantidade e não repetir', () => {
    expect(parseProductCreate({ name: 'Caloi Elite', initial_quantity: 3 })).toMatchObject({ tracking: 'UNIT', initial_units: null });
    expect(err(() => parseProductCreate({ name: 'X', initial_quantity: 2, initial_units: [{ serial_number: 'ab1' }] })))
      .toMatchObject({ reason: 'must_match_quantity' });
    expect(err(() => parseProductCreate({ name: 'X', initial_quantity: 2, initial_units: [{ serial_number: 'ab1' }, { serial_number: 'AB1' }] })))
      .toMatchObject({ reason: 'duplicate' });
  });
  it('dinheiro só como string de centavos', () => {
    expect(err(() => parseProductCreate({ name: 'X', initial_quantity: 0, sale_price_cents: 800000 }))).toMatchObject({ reason: 'invalid_money_cents' });
    expect(err(() => parseProductCreate({ name: 'X', initial_quantity: 0, sale_price_cents: '0800' }))).toMatchObject({ reason: 'invalid_money_cents' });
    expect(parseProductCreate({ name: 'X', initial_quantity: 0, sale_price_cents: '800000' })).toMatchObject({ sale_price_cents: '800000' });
  });
});
