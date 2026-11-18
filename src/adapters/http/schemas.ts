// Schemas fechados dos comandos (contracts/api.md §4) e mapeamento para os nomes de persistência.
import {
  array, boolTrue, date, enumOf, instant, int, moneyCents, nonNegativeInt, nullable, object, opt, optionalText,
  positiveInt, req, string, uuid, type Parser,
} from './validate';
import { fieldError } from './errors';
import {
  normalizeBrMobile, normalizeCnpj, normalizeCpf, normalizeEmail, normalizeSerial, todayInSaoPaulo, validateBirthday,
} from '../../modules/crm/contact-rules';

const name = string({ min: 1, max: 200 });
const birthday = object({ day: req(int({ min: 1, max: 31 })), month: req(int({ min: 1, max: 12 })), year: opt(nullable(int({ min: 1900, max: 9999 }))) });
const address = object({
  postal_code: opt(optionalText(9)), street: opt(optionalText(200)), number: opt(optionalText(20)),
  complement: opt(optionalText(100)), district: opt(optionalText(100)), city: opt(optionalText(100)), state: opt(optionalText(2)),
});
const personType = enumOf('PF', 'PJ');

const contactCreate = object({
  name: req(name), mobile_phone: req(string({ min: 1, max: 30 })),
  cpf: opt(optionalText(20)), email: opt(optionalText(254)), notes: opt(optionalText(5000)),
  birthday: opt(nullable(birthday)), person_type: opt(personType),
});

type Rec = Record<string, unknown>;

function mapBirthday(out: Rec, b: { day: number; month: number; year?: number | null } | null | undefined, present: boolean) {
  if (!present) return;
  if (b === null || b === undefined) Object.assign(out, { birthday_day: null, birthday_month: null, birthday_year: null });
  else Object.assign(out, validateBirthday(b, todayInSaoPaulo()));
}

function mapOptional(out: Rec, src: Rec, key: string, target: string, fn: (s: string) => string) {
  if (!(key in src)) return;
  const v = src[key] as string | null;
  out[target] = v === null || v === undefined ? null : fn(v);
}

export function parseContactCreate(body: unknown): Rec {
  const p = contactCreate(body, '');
  const out: Rec = { name: p.name, mobile_e164: normalizeBrMobile(p.mobile_phone) };
  mapOptional(out, p, 'cpf', 'cpf', (s) => normalizeCpf(s));
  mapOptional(out, p, 'email', 'email', (s) => normalizeEmail(s));
  if ('notes' in p) out.note = p.notes ?? null;
  if (p.person_type) out.person_type = p.person_type;
  if (out.cpf && p.person_type === 'PJ') throw fieldError('cpf', 'cpf_requires_pf');
  mapBirthday(out, p.birthday, 'birthday' in p);
  return out;
}

const contactPatch = object({
  expected_version: req(positiveInt), name: opt(name), mobile_phone: opt(nullable(string({ max: 30 }))),
  cpf: opt(optionalText(20)), email: opt(optionalText(254)), notes: opt(optionalText(5000)), birthday: opt(nullable(birthday)),
  person_type: opt(nullable(personType)), trade_name: opt(optionalText(200)), cnpj: opt(optionalText(20)),
  phone: opt(optionalText(30)), address: opt(nullable(address)), owner_id: opt(uuid),
});

export function parseContactPatch(body: unknown): Rec {
  const p = contactPatch(body, '') as Rec;
  const out: Rec = { expected_version: p.expected_version };
  if ('name' in p) out.name = p.name;
  if ('mobile_phone' in p) {
    const v = p.mobile_phone as string | null;
    out.mobile_e164 = v === null || v === '' ? null : normalizeBrMobile(v);
  }
  mapOptional(out, p, 'cpf', 'cpf', (s) => normalizeCpf(s));
  mapOptional(out, p, 'cnpj', 'cnpj', (s) => normalizeCnpj(s));
  mapOptional(out, p, 'email', 'email', (s) => normalizeEmail(s));
  for (const k of ['trade_name', 'phone', 'person_type', 'owner_id'] as const) if (k in p) out[k] = p[k] ?? null;
  if ('notes' in p) out.note = p.notes ?? null;
  if ('address' in p) out.address = p.address;
  mapBirthday(out, p.birthday as never, 'birthday' in p);
  return out;
}

const supplierCreate = object({
  name: req(name), person_type: req(personType), trade_name: opt(optionalText(200)), mobile_phone: opt(optionalText(30)),
  phone: opt(optionalText(30)), cpf: opt(optionalText(20)), cnpj: opt(optionalText(20)), email: opt(optionalText(254)),
  address: opt(nullable(address)), notes: opt(optionalText(5000)),
});

export function parseSupplierCreate(body: unknown): Rec {
  const p = supplierCreate(body, '') as Rec;
  const out: Rec = { name: p.name, person_type: p.person_type, trade_name: p.trade_name ?? null, phone: p.phone ?? null,
    note: p.notes ?? null, address: p.address ?? null };
  mapOptional(out, p, 'mobile_phone', 'mobile_e164', (s) => normalizeBrMobile(s));
  mapOptional(out, p, 'cpf', 'cpf', (s) => normalizeCpf(s));
  mapOptional(out, p, 'cnpj', 'cnpj', (s) => normalizeCnpj(s));
  mapOptional(out, p, 'email', 'email', (s) => normalizeEmail(s));
  if (out.cpf && p.person_type === 'PJ') throw fieldError('cpf', 'cpf_requires_pf');
  if (out.cnpj && p.person_type === 'PF') throw fieldError('cnpj', 'cnpj_requires_pj');
  return out;
}

const addRole = object({ expected_version: req(positiveInt), role: req(enumOf('CUSTOMER', 'SUPPLIER')),
  mobile_phone: opt(string({ max: 30 })), person_type: opt(personType), owner_id: opt(uuid) });
export function parseAddRole(body: unknown): Rec {
  const p = addRole(body, '') as Rec;
  const out: Rec = { expected_version: p.expected_version, role: p.role, person_type: p.person_type ?? null, owner_id: p.owner_id ?? null };
  if (p.mobile_phone) out.mobile_e164 = normalizeBrMobile(p.mobile_phone as string);
  return out;
}

const tags = array(string({ min: 1, max: 40 }), { max: 20 });
export const opportunityCreate = object({
  contact_id: req(uuid), title: opt(string({ max: 200 })), stage_id: opt(uuid), owner_id: opt(uuid),
  interest_product_id: opt(nullable(uuid)), expected_value_cents: opt(nullable(moneyCents)),
  expected_purchase_date: opt(nullable(date)), tags: opt(tags),
});
export const opportunityPatch = object({
  expected_version: req(positiveInt), title: opt(string({ min: 1, max: 200 })), owner_id: opt(uuid),
  interest_product_id: opt(nullable(uuid)), expected_value_cents: opt(nullable(moneyCents)),
  expected_purchase_date: opt(nullable(date)), tags: opt(tags), next_contact_at: opt(nullable(instant)),
});
export const moveOpportunity: Parser<Rec> = (v, path) => {
  const p = object({
    expected_version: req(positiveInt), stage_id: req(uuid), expected_stage_version: req(positiveInt),
    expected_source_cards_version: req(nonNegativeInt), expected_target_cards_version: req(nonNegativeInt),
    before_opportunity_id: opt(uuid), after_opportunity_id: opt(uuid), loss_reason: opt(optionalText(500)),
  })(v, path);
  if (p.before_opportunity_id && p.after_opportunity_id) throw fieldError('before_opportunity_id', 'use_only_one_anchor');
  return p;
};
export const activityCreate = object({ kind: req(enumOf('NOTE', 'CALL', 'TASK')), body: req(string({ min: 1, max: 5000 })),
  due_at: opt(nullable(instant)) });
export const stageCreate = object({ name: req(string({ min: 1, max: 60 })), position: req(nonNegativeInt), kind: req(enumOf('OPEN', 'WON', 'LOST')) });
export const stagePatch = object({ expected_version: req(positiveInt), name: req(string({ min: 1, max: 60 })) });
export const stageArchive = object({ expected_version: req(positiveInt) });
export const stageReorder = object({ stages: req(array(object({ id: req(uuid), expected_version: req(positiveInt) }), { min: 1, max: 50 })) });
export const crmSettingsPatch = object({ expected_version: req(positiveInt), default_lead_owner_id: req(nullable(uuid)) });

export const leadSubmission = (body: unknown): Rec => {
  if (typeof body !== 'object' || body === null) throw fieldError('body', 'must_be_object');
  const { submission_id, utm, ...rest } = body as Rec;
  const sid = uuid(submission_id, 'submission_id');
  const out = parseContactCreate(rest);
  const utmP = utm === undefined ? null : object({
    source: opt(optionalText(100)), medium: opt(optionalText(100)), campaign: opt(optionalText(150)),
    content: opt(optionalText(150)), term: opt(optionalText(150)),
  })(utm, 'utm');
  return { ...out, submission_id: sid, utm: utmP };
};

// ---------------------------------------------------------------- catálogo e estoque
const serialList = array(object({ serial_number: opt(optionalText(60)) }), { max: 200 });
function normalizeUnits(units: Array<{ serial_number?: string | null }> | undefined, qty: number, path: string) {
  if (!units) return null;
  if (units.length !== qty) throw fieldError(path, 'must_match_quantity');
  const seen = new Set<string>();
  return units.map((u, i) => {
    const s = u.serial_number ? normalizeSerial(u.serial_number, `${path}[${i}].serial_number`) : null;
    if (s) {
      if (seen.has(s)) throw fieldError(`${path}[${i}].serial_number`, 'duplicate');
      seen.add(s);
    }
    return { serial_number: s };
  });
}

const optStr = (max: number) => opt(optionalText(max));
const productFields = {
  sku: optStr(60), sale_price_cents: opt(nullable(moneyCents)), brand: optStr(100), category: optStr(100), size: optStr(40),
  color: optStr(40), measurement_unit: optStr(10), warranty_note: optStr(300), supplier_contact_id: opt(nullable(uuid)),
  minimum_stock: opt(nullable(nonNegativeInt)), location: optStr(100), variant_description: optStr(300),
};
const productCreate = object({
  name: req(name), initial_quantity: req(int({ min: 0, max: 200 })), type: opt(enumOf('BIKE', 'ACCESSORY')),
  acquisition_cost_cents: opt(nullable(moneyCents)), initial_units: opt(serialList), ...productFields,
});
export function parseProductCreate(body: unknown): Rec {
  const p = productCreate(body, '') as Rec;
  const type = (p.type as string) ?? 'BIKE';
  const qty = p.initial_quantity as number;
  if (p.initial_units && type !== 'BIKE') throw fieldError('initial_units', 'only_for_bikes');
  const { type: _t, initial_units, ...rest } = p;
  return { ...rest, tracking: type === 'BIKE' ? 'UNIT' : 'QUANTITY',
    initial_units: normalizeUnits(initial_units as never, qty, 'initial_units') };
}
const productPatch = object({
  expected_version: req(positiveInt), name: opt(name), photo_attachment_id: opt(nullable(uuid)),
  reference_cost_cents: opt(nullable(moneyCents)), type: opt(enumOf('BIKE', 'ACCESSORY')), complete_import: opt(boolTrue),
  ...productFields,
});
export function parseProductPatch(body: unknown): Rec {
  const p = productPatch(body, '') as Rec;
  const { type, complete_import: _c, ...rest } = p;
  if (type) (rest as Rec).tracking = type === 'BIKE' ? 'UNIT' : 'QUANTITY';
  return rest;
}
export const productArchive = object({ expected_version: req(positiveInt), reason: req(string({ min: 1, max: 300 })) });

const reason = string({ min: 1, max: 300 });
const stockReceipt = object({
  product_id: req(uuid), expected_inventory_version: req(positiveInt), quantity: req(int({ min: 1, max: 200 })), reason: req(reason),
  units: opt(serialList), unit_acquisition_cost_cents: opt(nullable(moneyCents)), supplier_contact_id: opt(nullable(uuid)),
  purchase_document_reference: opt(optionalText(100)), payable_id: opt(nullable(uuid)), evidence_attachment_id: opt(nullable(uuid)),
});
export function parseStockReceipt(body: unknown): Rec {
  const p = stockReceipt(body, '') as Rec;
  if (p.payable_id || p.evidence_attachment_id) throw fieldError('payable_id', 'capability_unavailable_until_T10');
  return { ...p, units: normalizeUnits(p.units as never, p.quantity as number, 'units') };
}
export const stockAdjustment: Parser<Rec> = (v, path) => {
  const p = object({ product_id: req(uuid), expected_inventory_version: req(positiveInt),
    quantity_delta: req(int({ min: -200, max: 200 })), unit_ids: opt(array(uuid, { max: 200 })), reason: req(reason) })(v, path);
  if (p.quantity_delta === 0) throw fieldError('quantity_delta', 'must_be_non_zero');
  return p;
};
const stockRecount = object({
  product_id: req(uuid), expected_inventory_version: req(positiveInt), counted_quantity: req(int({ min: 0, max: 10000 })),
  observed_unit_ids: opt(array(uuid, { max: 10000 })), reason: req(reason), confirm_initial_opening: opt(boolTrue),
  unit_acquisition_cost_cents: opt(nullable(moneyCents)),
  initial_units: opt(array(object({ serial_number: opt(optionalText(60)), acquisition_cost_cents: opt(nullable(moneyCents)) }), { max: 200 })),
});
export function parseStockRecount(body: unknown): Rec {
  const p = stockRecount(body, '') as Rec;
  if (p.initial_units) {
    if ((p.initial_units as unknown[]).some((u) => (u as Rec).acquisition_cost_cents != null))
      throw fieldError('initial_units', 'per_unit_cost_not_supported_use_unit_acquisition_cost_cents');
    p.initial_units = (p.initial_units as Array<{ serial_number?: string | null }>).map((u, i) => ({
      serial_number: u.serial_number ? normalizeSerial(u.serial_number, `initial_units[${i}].serial_number`) : null }));
  }
  return p;
}
export function parseUnitIdentification(body: unknown): Rec {
  const p = object({ expected_version: req(positiveInt), serial_number: opt(optionalText(60)), chassis_number: opt(optionalText(60)) })(body, '') as Rec;
  for (const k of ['serial_number', 'chassis_number'])
    if (k in p && p[k] !== null) p[k] = normalizeSerial(p[k] as string, k);
  return p;
}

export const attachmentCreate = object({
  product_id: req(uuid), content_type: req(enumOf('image/jpeg', 'image/png', 'image/webp')),
  size_bytes: req(int({ min: 1, max: 8 * 1024 * 1024 })),
});

export const invitationCreate = object({ email: req(string({ min: 3, max: 254 })), name: req(name), profile: req(enumOf('SELLER', 'OWNER')) });
export const accessPatch = object({ expected_version: req(positiveInt), active: opt((v, p) => { if (typeof v !== 'boolean') throw fieldError(p, 'must_be_boolean'); return v; }), profile: opt(enumOf('SELLER', 'OWNER')) });
