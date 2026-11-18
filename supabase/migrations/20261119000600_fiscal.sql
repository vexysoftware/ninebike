-- NINEBIKE OS — T11 preparo fiscal com revisão/aprovação humana. Modo UNDECIDED: nada é transmitido.
-- A emissão oficial continua no emissor atual (SHOP); o Ninebike pode vincular a evidência da nota autorizada lá.

create schema if not exists fiscal;
revoke all on schema fiscal from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke all on schema fiscal from anon, authenticated'; end if;
end $$;

create table fiscal.settings (
  id boolean primary key default true check (id),
  mode text not null default 'UNDECIDED' check (mode in ('UNDECIDED', 'OS_PRIMARY')),
  issuer jsonb not null default '{}'::jsonb,  -- razão social, CNPJ, IE, UF, regime: informados pelo responsável
  version integer not null default 1
);
insert into fiscal.settings (id) values (true);

alter table inventory.products add column if not exists ncm text check (ncm ~ '^[0-9]{8}$');

create table fiscal.fiscal_documents (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references sales.orders(id),
  origin text not null check (origin in ('APP_CREATED', 'EXTERNALLY_DETECTED')),
  model text not null default '55' check (model in ('55', '65')),
  purpose text not null default 'NORMAL' check (purpose in ('NORMAL')),
  revision integer not null default 1,
  business_snapshot jsonb not null,
  snapshot_hash text not null,
  validation_report jsonb,
  review_state text not null check (review_state in ('DRAFT', 'INVALID', 'READY_FOR_REVIEW', 'APPROVED', 'EXTERNAL_EVIDENCE')),
  approved_by uuid references identity.profiles(id),
  approved_at timestamptz,
  approved_hash text,
  approval_session text,
  official_status text not null default 'NOT_SENT' check (official_status in ('NOT_SENT', 'AUTHORIZED', 'CANCELLED', 'UNKNOWN')),
  access_key text check (access_key ~ '^[0-9]{44}$'),
  series text, number text, protocol text, authorized_at timestamptz,
  created_by uuid not null references identity.profiles(id),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index fiscal_documents_order_live on fiscal.fiscal_documents (order_id) where order_id is not null and official_status <> 'CANCELLED';
create unique index fiscal_documents_key on fiscal.fiscal_documents (access_key) where access_key is not null;

create or replace function fiscal.hash(j jsonb) returns text language sql immutable as $$
  select encode(sha256(convert_to(j::text, 'UTF8')), 'hex')
$$;

create or replace function fiscal.can_see(p_actor uuid, p_role text, d fiscal.fiscal_documents) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_role = 'OWNER' or exists (select 1 from sales.orders o where o.id = d.order_id and o.owner_id = p_actor)
$$;

-- Validação local dos dados exigidos; NÃO é validação de schema/XSD (depende do provedor homologado).
create or replace function fiscal.validate(s jsonb, p_total bigint) returns jsonb language plpgsql immutable as $$
declare issues jsonb := '[]'::jsonb; it jsonb; i int := 0; v_sum bigint := 0; r jsonb := s->'recipient';
begin
  if coalesce(r->>'name', '') = '' then issues := issues || jsonb_build_object('field', 'recipient.name', 'reason', 'required'); end if;
  if r->>'person_type' is null then issues := issues || jsonb_build_object('field', 'recipient.person_type', 'reason', 'required');
  elsif r->>'person_type' = 'PF' and coalesce(r->>'cpf', '') !~ '^[0-9]{11}$' then issues := issues || jsonb_build_object('field', 'recipient.cpf', 'reason', 'required_for_pf');
  elsif r->>'person_type' = 'PJ' and coalesce(r->>'cnpj', '') !~ '^[0-9]{14}$' then issues := issues || jsonb_build_object('field', 'recipient.cnpj', 'reason', 'required_for_pj');
  end if;
  if s->>'model' = '55' then
    if coalesce(r->'address'->>'street', '') = '' or coalesce(r->'address'->>'city', '') = '' or coalesce(r->'address'->>'state', '') !~ '^[A-Z]{2}$'
       or coalesce(r->'address'->>'postal_code', '') !~ '^[0-9]{8}$' or coalesce(r->'address'->>'number', '') = '' then
      issues := issues || jsonb_build_object('field', 'recipient.address', 'reason', 'required_for_model_55');
    end if;
  end if;
  for it in select * from jsonb_array_elements(s->'items') loop
    if coalesce(it->>'ncm', '') !~ '^[0-9]{8}$' then issues := issues || jsonb_build_object('field', 'items[' || i || '].ncm', 'reason', 'required'); end if;
    if coalesce(it->>'cfop', '') !~ '^[1-7][0-9]{3}$' then issues := issues || jsonb_build_object('field', 'items[' || i || '].cfop', 'reason', 'required'); end if;
    v_sum := v_sum + (it->>'total_cents')::bigint; i := i + 1;
  end loop;
  if v_sum + coalesce((s->>'freight_cents')::bigint, 0) <> p_total then
    issues := issues || jsonb_build_object('field', 'totals', 'reason', 'does_not_match_order', 'items_cents', v_sum::text, 'order_cents', p_total::text);
  end if;
  if coalesce(s->'issuer'->>'cnpj', '') !~ '^[0-9]{14}$' or coalesce(s->'issuer'->>'state', '') !~ '^[A-Z]{2}$' then
    issues := issues || jsonb_build_object('field', 'issuer', 'reason', 'issuer_not_configured');
  end if;
  return jsonb_build_object('ok', jsonb_array_length(issues) = 0, 'issues', issues, 'scope', 'local_required_fields_only');
end $$;

create or replace function fiscal.doc_json(d fiscal.fiscal_documents) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', d.id, 'order_id', d.order_id,
    'order_number', (select display_number from sales.orders where id = d.order_id), 'origin', d.origin, 'model', d.model,
    'revision', d.revision, 'snapshot', d.business_snapshot, 'snapshot_hash', d.snapshot_hash, 'validation', d.validation_report,
    'review_state', d.review_state, 'approved_by_name', (select name from identity.profiles where id = d.approved_by),
    'approved_at', d.approved_at, 'approval_current', d.approved_hash = d.snapshot_hash,
    'official_status', d.official_status, 'access_key', d.access_key, 'series', d.series, 'number', d.number,
    'protocol', d.protocol, 'authorized_at', d.authorized_at, 'version', d.version, 'created_at', d.created_at,
    'transmission', (select jsonb_build_object('mode', mode, 'available', false,
       'reason', case when mode = 'UNDECIDED' then 'issuer_not_homologated' else 'provider_adapter_not_installed' end) from fiscal.settings))
$$;

create or replace function fiscal.sync_order(p_order uuid) returns void language sql security definer set search_path = '' as $$
  update sales.orders o set fiscal_state = coalesce((select case
      when d.official_status = 'AUTHORIZED' then 'AUTHORIZED_EXTERNAL'
      when d.review_state = 'APPROVED' then 'APPROVED_INTERNALLY'
      when d.review_state = 'READY_FOR_REVIEW' then 'IN_REVIEW' else 'DRAFT' end
    from fiscal.fiscal_documents d where d.order_id = o.id and d.official_status <> 'CANCELLED'), 'NOT_PREPARED')
  where o.id = p_order
$$;

-- Preparar: rascunho a partir do pedido (dados já conhecidos); vendedora pode preparar da própria venda.
create or replace function api.fiscal_document_create(p_ctx jsonb, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (p_ctx->>'actor_id')::uuid; v_role text := identity.require_actor(v_actor, 'crm.write');
        o sales.orders; c crm.contacts; v_snap jsonb; v_id uuid; v_issuer jsonb;
begin
  select * into o from sales.orders where id = (p->>'order_id')::uuid for update;
  if not found or (v_role <> 'OWNER' and o.owner_id <> v_actor) then perform api.fail('NOT_FOUND'); end if;
  if o.commercial_state <> 'CONFIRMED' then perform api.fail('VALIDATION_FAILED', jsonb_build_object('reason', 'order_not_confirmed')); end if;
  if exists (select 1 from fiscal.fiscal_documents where order_id = o.id and official_status <> 'CANCELLED') then
    perform api.fail('OPERATION_IN_PROGRESS', jsonb_build_object('reason', 'document_exists',
      'document_id', (select id from fiscal.fiscal_documents where order_id = o.id and official_status <> 'CANCELLED')));
  end if;
  select * into c from crm.contacts where id = o.contact_id;
  select issuer into v_issuer from fiscal.settings;
  v_snap := jsonb_build_object('model', coalesce(p->>'model', '55'), 'issuer', v_issuer, 'nature', 'Venda de mercadoria',
    'recipient', jsonb_build_object('name', o.customer_snapshot->>'name', 'person_type', c.person_type,
      'cpf', o.customer_snapshot->>'cpf', 'cnpj', o.customer_snapshot->>'cnpj', 'email', o.customer_snapshot->>'email',
      'address', coalesce(c.address, '{}'::jsonb)),
    'items', (select jsonb_agg(jsonb_build_object('position', i.position, 'description', i.description_snapshot,
        'sku', pr.sku, 'ncm', pr.ncm, 'cfop', null, 'unit', coalesce(pr.measurement_unit, 'UN'), 'quantity', i.quantity::text,
        'unit_price_cents', i.unit_price_cents::text, 'discount_cents', i.discount_cents::text,
        'total_cents', (i.unit_price_cents * i.quantity - i.discount_cents)::text,
        'serial_number', (select serial_normalized from inventory.inventory_units where id = i.unit_id)) order by i.position)
      from sales.order_items i join inventory.products pr on pr.id = i.product_id where i.order_id = o.id),
    'freight_cents', o.freight_cents::text, 'total_cents', o.total_cents::text,
    'payment', (select jsonb_agg(jsonb_build_object('mode', approved_method, 'principal_cents', principal_cents::text) order by position)
      from finance.payment_allocations where order_id = o.id and state = 'ACTIVE'),
    'additional_info', null);
  insert into fiscal.fiscal_documents (order_id, origin, model, business_snapshot, snapshot_hash, review_state, created_by)
  values (o.id, 'APP_CREATED', coalesce(p->>'model', '55'), v_snap, fiscal.hash(v_snap), 'DRAFT', v_actor) returning id into v_id;
  perform fiscal.sync_order(o.id);
  perform audit.record(p_ctx, 'fiscal.draft_created', 'fiscal_document', v_id, jsonb_build_object('order', o.display_number));
  return jsonb_build_object('id', v_id, 'version', 1);
end $$;

-- Editar rascunho: nova revisão; qualquer mudança invalida aprovação anterior.
create or replace function api.fiscal_document_update(p_ctx jsonb, p_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (p_ctx->>'actor_id')::uuid; v_role text := identity.require_actor(v_actor, 'crm.write');
        d fiscal.fiscal_documents; s jsonb; it jsonb;
begin
  select * into d from fiscal.fiscal_documents where id = p_id for update;
  if not found or not fiscal.can_see(v_actor, v_role, d) then perform api.fail('NOT_FOUND'); end if;
  if d.version <> (p->>'expected_version')::int then perform api.fail('VERSION_CONFLICT'); end if;
  if d.official_status <> 'NOT_SENT' or d.origin <> 'APP_CREATED' then perform api.fail('VALIDATION_FAILED', jsonb_build_object('reason', 'document_locked')); end if;
  s := d.business_snapshot;
  if p ? 'recipient' then s := jsonb_set(s, '{recipient}', (s->'recipient') || (p->'recipient')); end if;
  if p ? 'additional_info' then s := jsonb_set(s, '{additional_info}', coalesce(p->'additional_info', 'null'::jsonb)); end if;
  if p ? 'items' then
    for it in select * from jsonb_array_elements(p->'items') loop
      s := jsonb_set(s, array['items', it->>'position'], (s->'items'->((it->>'position')::int)) || (it - 'position'));
    end loop;
  end if;
  s := jsonb_set(s, '{issuer}', (select issuer from fiscal.settings));
  update fiscal.fiscal_documents set business_snapshot = s, snapshot_hash = fiscal.hash(s), revision = revision + 1,
    review_state = 'DRAFT', validation_report = null, version = version + 1, updated_at = now()
   where id = p_id;
  perform fiscal.sync_order(d.order_id);
  perform audit.record(p_ctx, 'fiscal.draft_updated', 'fiscal_document', p_id,
    jsonb_build_object('revision', d.revision + 1, 'approval_invalidated', d.review_state = 'APPROVED'));
  return jsonb_build_object('id', p_id, 'version', d.version + 1);
end $$;

create or replace function api.fiscal_document_validate(p_ctx jsonb, p_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (p_ctx->>'actor_id')::uuid; v_role text := identity.require_actor(v_actor, 'crm.write');
        d fiscal.fiscal_documents; v_rep jsonb; v_total bigint;
begin
  select * into d from fiscal.fiscal_documents where id = p_id for update;
  if not found or not fiscal.can_see(v_actor, v_role, d) then perform api.fail('NOT_FOUND'); end if;
  if d.version <> (p->>'expected_version')::int then perform api.fail('VERSION_CONFLICT'); end if;
  if d.review_state not in ('DRAFT', 'INVALID') then perform api.fail('VALIDATION_FAILED', jsonb_build_object('reason', 'not_draft')); end if;
  select total_cents into v_total from sales.orders where id = d.order_id;
  v_rep := fiscal.validate(d.business_snapshot, v_total);
  update fiscal.fiscal_documents set validation_report = v_rep,
    review_state = case when (v_rep->>'ok')::boolean then 'READY_FOR_REVIEW' else 'INVALID' end, version = version + 1, updated_at = now()
   where id = p_id;
  perform fiscal.sync_order(d.order_id);
  return jsonb_build_object('id', p_id, 'version', d.version + 1, 'validation', v_rep);
end $$;

-- Aprovação humana: OWNER, MFA recente, sobre o hash exato revisado. Não transmite.
create or replace function api.fiscal_document_approve(p_ctx jsonb, p_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (p_ctx->>'actor_id')::uuid; d fiscal.fiscal_documents;
begin
  perform identity.require_actor(v_actor, 'crm.manage');
  if coalesce((p_ctx->>'mfa_recent')::boolean, false) is not true then perform api.fail('MFA_RECENCY_REQUIRED'); end if;
  select * into d from fiscal.fiscal_documents where id = p_id for update;
  if not found then perform api.fail('NOT_FOUND'); end if;
  if d.version <> (p->>'expected_version')::int or d.snapshot_hash <> p->>'snapshot_hash' then perform api.fail('VERSION_CONFLICT', jsonb_build_object('reason', 'snapshot_changed')); end if;
  if d.review_state <> 'READY_FOR_REVIEW' then perform api.fail('VALIDATION_FAILED', jsonb_build_object('reason', 'not_ready_for_review')); end if;
  update fiscal.fiscal_documents set review_state = 'APPROVED', approved_by = v_actor, approved_at = now(), approved_hash = d.snapshot_hash,
    approval_session = p_ctx->>'request_id', version = version + 1, updated_at = now() where id = p_id;
  perform fiscal.sync_order(d.order_id);
  perform audit.record(p_ctx, 'fiscal.approved', 'fiscal_document', p_id, jsonb_build_object('hash', d.snapshot_hash, 'revision', d.revision));
  return jsonb_build_object('id', p_id, 'version', d.version + 1);
end $$;

-- Evidência da nota autorizada no emissor atual (SHOP): vincula chave/número/protocolo. Não reemite nada.
create or replace function api.fiscal_external_evidence(p_ctx jsonb, p_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (p_ctx->>'actor_id')::uuid; d fiscal.fiscal_documents;
begin
  perform identity.require_actor(v_actor, 'crm.manage');
  select * into d from fiscal.fiscal_documents where id = p_id for update;
  if not found then perform api.fail('NOT_FOUND'); end if;
  if d.version <> (p->>'expected_version')::int then perform api.fail('VERSION_CONFLICT'); end if;
  if d.official_status <> 'NOT_SENT' then perform api.fail('VALIDATION_FAILED', jsonb_build_object('reason', 'already_has_official_status')); end if;
  begin
    update fiscal.fiscal_documents set official_status = 'AUTHORIZED', access_key = p->>'access_key', series = p->>'series',
      number = p->>'number', protocol = p->>'protocol', authorized_at = (p->>'authorized_at')::timestamptz,
      version = version + 1, updated_at = now() where id = p_id;
  exception when unique_violation then perform api.fail('VALIDATION_FAILED', jsonb_build_object('field', 'access_key', 'reason', 'duplicate')); end;
  perform fiscal.sync_order(d.order_id);
  perform audit.record(p_ctx, 'fiscal.external_evidence', 'fiscal_document', p_id, jsonb_build_object('access_key', p->>'access_key', 'issuer', 'external'));
  return jsonb_build_object('id', p_id, 'version', d.version + 1);
end $$;

create or replace function api.fiscal_document_get(p_actor uuid, p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_role text := identity.require_actor(p_actor, 'crm.read'); d fiscal.fiscal_documents;
begin
  select * into d from fiscal.fiscal_documents where id = p_id;
  if not found or not fiscal.can_see(p_actor, v_role, d) then perform api.fail('NOT_FOUND'); end if;
  return fiscal.doc_json(d);
end $$;

create or replace function api.fiscal_document_list(p_actor uuid, p jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_role text := identity.require_actor(p_actor, 'crm.read');
begin
  return coalesce((select jsonb_agg(fiscal.doc_json(d) - 'snapshot' order by d.created_at desc) from (
    select * from fiscal.fiscal_documents d where fiscal.can_see(p_actor, v_role, d)
      and (p->>'review_state' is null or d.review_state = p->>'review_state')
    order by d.created_at desc limit 200) d), '[]'::jsonb);
end $$;

create or replace function api.fiscal_settings_get(p_actor uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform identity.require_actor(p_actor, 'crm.manage');
  return (select jsonb_build_object('mode', mode, 'issuer', issuer, 'version', version) from fiscal.settings);
end $$;

-- Dados do emitente; o modo continua UNDECIDED (ativar transmissão exige provedor homologado — fora desta função).
create or replace function api.fiscal_settings_update(p_ctx jsonb, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (p_ctx->>'actor_id')::uuid; v fiscal.settings;
begin
  perform identity.require_actor(v_actor, 'crm.manage');
  if coalesce((p_ctx->>'mfa_recent')::boolean, false) is not true then perform api.fail('MFA_RECENCY_REQUIRED'); end if;
  select * into v from fiscal.settings for update;
  if v.version <> (p->>'expected_version')::int then perform api.fail('VERSION_CONFLICT'); end if;
  update fiscal.settings set issuer = p->'issuer', version = version + 1;
  perform audit.record(p_ctx, 'fiscal.issuer_updated', 'fiscal_settings', null, p->'issuer');
  return jsonb_build_object('version', v.version + 1);
end $$;

create or replace function api.product_set_ncm(p_ctx jsonb, p_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform identity.require_actor((p_ctx->>'actor_id')::uuid, 'catalog.manage');
  update inventory.products set ncm = p->>'ncm', updated_at = now() where id = p_id;
  if not found then perform api.fail('NOT_FOUND'); end if;
  return jsonb_build_object('id', p_id);
end $$;

grant execute on all functions in schema api to ninebike_api;
revoke execute on function api.fail(text, jsonb) from ninebike_api;
revoke all on all functions in schema fiscal from public;
revoke all on all tables in schema fiscal from public;
alter table fiscal.settings enable row level security;
alter table fiscal.fiscal_documents enable row level security;
