-- NINEBIKE OS — T02 contatos, fornecedores, pipeline, atividades, aniversariantes e captura pública.

create schema if not exists crm;
revoke all on schema crm from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on schema crm from anon, authenticated';
  end if;
end $$;

-- ---------------------------------------------------------------- validações puras
create or replace function crm.valid_cpf(p text) returns boolean language plpgsql immutable as $$
declare s int; d1 int; d2 int; i int;
begin
  if p is null then return true; end if;
  if p !~ '^[0-9]{11}$' or p ~ '^(.)\1{10}$' then return false; end if;
  s := 0; for i in 1..9 loop s := s + substr(p, i, 1)::int * (11 - i); end loop;
  d1 := (s * 10) % 11; if d1 = 10 then d1 := 0; end if;
  s := 0; for i in 1..10 loop s := s + substr(p, i, 1)::int * (12 - i); end loop;
  d2 := (s * 10) % 11; if d2 = 10 then d2 := 0; end if;
  return d1 = substr(p, 10, 1)::int and d2 = substr(p, 11, 1)::int;
end $$;

create or replace function crm.valid_cnpj(p text) returns boolean language plpgsql immutable as $$
declare w1 int[] := array[5,4,3,2,9,8,7,6,5,4,3,2]; w2 int[] := array[6,5,4,3,2,9,8,7,6,5,4,3,2];
        s int; d1 int; d2 int; i int;
begin
  if p is null then return true; end if;
  if p !~ '^[0-9]{14}$' or p ~ '^(.)\1{13}$' then return false; end if;
  s := 0; for i in 1..12 loop s := s + substr(p, i, 1)::int * w1[i]; end loop;
  d1 := case when s % 11 < 2 then 0 else 11 - s % 11 end;
  s := 0; for i in 1..13 loop s := s + substr(p, i, 1)::int * w2[i]; end loop;
  d2 := case when s % 11 < 2 then 0 else 11 - s % 11 end;
  return d1 = substr(p, 13, 1)::int and d2 = substr(p, 14, 1)::int;
end $$;

-- Dia/mês juntos; ano só com dia/mês. Sem ano, valida em referência bissexta (2000) sem persistir ano fictício.
create or replace function crm.valid_birthday(d smallint, m smallint, y smallint) returns boolean
language plpgsql immutable as $$
begin
  if d is null and m is null and y is null then return true; end if;
  if d is null or m is null then return false; end if;
  if y is not null and (y < 1900) then return false; end if;
  perform make_date(coalesce(y, 2000)::int, m::int, d::int);
  return true;
exception when others then return false;
end $$;

-- ---------------------------------------------------------------- tabelas
create table crm.contacts (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> '' and length(name) <= 200),
  person_type text check (person_type in ('PF', 'PJ')),
  trade_name text check (length(trade_name) <= 200),
  mobile_e164 text check (mobile_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  phone text check (length(phone) <= 30),
  cpf text check (crm.valid_cpf(cpf)),
  cnpj text check (crm.valid_cnpj(cnpj)),
  email text check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(email) <= 254),
  note text check (length(note) <= 5000),
  address jsonb,
  owner_id uuid references identity.profiles(id),
  contact_purpose text not null default 'COMMERCIAL',
  consent_evidence jsonb,
  merged_into_id uuid references crm.contacts(id),
  migration_pending boolean not null default false,
  birthday_day smallint,
  birthday_month smallint,
  birthday_year smallint,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (crm.valid_birthday(birthday_day, birthday_month, birthday_year)),
  check (cpf is null or person_type is distinct from 'PJ'),
  check (cnpj is null or person_type is distinct from 'PF')
);
create index contacts_owner_name on crm.contacts (owner_id, name);
create index contacts_mobile on crm.contacts (mobile_e164) where mobile_e164 is not null;
create index contacts_email on crm.contacts (lower(email)) where email is not null;
create index contacts_cpf on crm.contacts (cpf) where cpf is not null;
create index contacts_created on crm.contacts (created_at desc, id desc);
create index contacts_birthday on crm.contacts (birthday_month, birthday_day) where birthday_month is not null;

create table crm.contact_roles (
  contact_id uuid not null references crm.contacts(id) on delete restrict,
  role text not null check (role in ('CUSTOMER', 'SUPPLIER')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (contact_id, role)
);

create table crm.settings (
  id boolean primary key default true check (id),
  default_lead_owner_id uuid references identity.profiles(id),
  version integer not null default 1,
  updated_at timestamptz not null default now()
);
insert into crm.settings (id) values (true);

create table crm.pipeline_stages (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> '' and length(name) <= 60),
  position integer not null check (position >= 0),
  kind text not null check (kind in ('OPEN', 'WON', 'LOST')),
  active boolean not null default true,
  cards_version bigint not null default 0,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index pipeline_stages_active_position on crm.pipeline_stages (position) where active;

insert into crm.pipeline_stages (name, position, kind) values
  ('Novo', 0, 'OPEN'), ('Contato', 1, 'OPEN'), ('Qualificação', 2, 'OPEN'), ('Proposta', 3, 'OPEN'),
  ('Negociação', 4, 'OPEN'), ('Aguardando pagamento', 5, 'OPEN'), ('Ganho', 6, 'WON'), ('Perdido', 7, 'LOST');

create table crm.lead_submissions (
  submission_id uuid primary key,
  request_hash text not null,
  contact_id uuid not null references crm.contacts(id),
  opportunity_id uuid,
  source text not null,
  utm jsonb,
  client_hash text,
  received_at timestamptz not null default now()
);
create index lead_submissions_client on crm.lead_submissions (client_hash, received_at);

create table crm.opportunities (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references crm.contacts(id),
  stage_id uuid not null references crm.pipeline_stages(id),
  position integer not null check (position >= 0),
  owner_id uuid not null references identity.profiles(id),
  title text not null check (btrim(title) <> '' and length(title) <= 200),
  lost_reason text check (length(lost_reason) <= 500),
  next_contact_at timestamptz,
  interest_product_id uuid,
  expected_value_cents bigint check (expected_value_cents >= 0),
  expected_purchase_date date,
  tags text[] not null default '{}',
  source text not null default 'manual',
  source_submission_id uuid references crm.lead_submissions(submission_id),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint opportunities_stage_position unique (stage_id, position) deferrable initially deferred
);
create index opportunities_owner on crm.opportunities (owner_id, stage_id, updated_at, id);
create index opportunities_contact on crm.opportunities (contact_id);
alter table crm.lead_submissions add constraint lead_submissions_opportunity
  foreign key (opportunity_id) references crm.opportunities(id);

create table crm.opportunity_access (
  opportunity_id uuid not null references crm.opportunities(id),
  user_id uuid not null references identity.profiles(id),
  primary key (opportunity_id, user_id)
);

create table crm.activities (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references crm.contacts(id),
  opportunity_id uuid references crm.opportunities(id),
  author_id uuid not null references identity.profiles(id),
  kind text not null check (kind in ('NOTE', 'CALL', 'TASK')),
  body text not null check (btrim(body) <> '' and length(body) <= 5000),
  due_at timestamptz,
  completed_at timestamptz,
  completed_by uuid references identity.profiles(id),
  created_at timestamptz not null default now()
);
create index activities_opportunity on crm.activities (opportunity_id, created_at, id);
create index activities_contact on crm.activities (contact_id, created_at, id);
create index activities_pending on crm.activities (due_at, id) where completed_at is null and due_at is not null;

-- ---------------------------------------------------------------- escopo
create or replace function crm.can_see_contact(p_actor uuid, p_role text, p_contact uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_role = 'OWNER'
      or exists (select 1 from crm.contacts c where c.id = p_contact and c.owner_id = p_actor)
      or exists (select 1 from crm.opportunities o where o.contact_id = p_contact and o.owner_id = p_actor)
      or exists (select 1 from crm.opportunities o join crm.opportunity_access a on a.opportunity_id = o.id
                  where o.contact_id = p_contact and a.user_id = p_actor)
$$;

create or replace function crm.can_see_opportunity(p_actor uuid, p_role text, p_opp uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_role = 'OWNER'
      or exists (select 1 from crm.opportunities o where o.id = p_opp and o.owner_id = p_actor)
      or exists (select 1 from crm.opportunity_access a where a.opportunity_id = p_opp and a.user_id = p_actor)
$$;

create or replace function crm.contact_json(c crm.contacts, p_role text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', c.id, 'name', c.name, 'person_type', c.person_type, 'trade_name', c.trade_name,
    'mobile_phone', c.mobile_e164, 'phone', c.phone, 'cpf', c.cpf, 'cnpj', c.cnpj, 'email', c.email,
    'notes', c.note, 'address', c.address, 'owner_id', c.owner_id,
    'owner_name', (select name from identity.profiles where id = c.owner_id),
    'migration_pending', c.migration_pending,
    'birthday', case when c.birthday_day is null then null else
       jsonb_build_object('day', c.birthday_day, 'month', c.birthday_month, 'year', c.birthday_year) end,
    'roles', coalesce((select jsonb_agg(r.role order by r.role) from crm.contact_roles r
                        where r.contact_id = c.id and r.active), '[]'::jsonb),
    'version', c.version, 'created_at', c.created_at, 'updated_at', c.updated_at)
$$;

-- Possíveis duplicatas apenas entre contatos visíveis ao ator; nunca mescla automaticamente.
create or replace function crm.duplicates(p_actor uuid, p_role text, p_mobile text, p_cpf text, p_email text,
                                          p_cnpj text, p_exclude uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name,
           'matched_on', array_remove(array[
              case when p_mobile is not null and c.mobile_e164 = p_mobile then 'mobile_phone' end,
              case when p_cpf is not null and c.cpf = p_cpf then 'cpf' end,
              case when p_cnpj is not null and c.cnpj = p_cnpj then 'cnpj' end,
              case when p_email is not null and c.email = p_email then 'email' end], null))), '[]'::jsonb)
    from crm.contacts c
   where c.id is distinct from p_exclude and c.merged_into_id is null
     and ((p_mobile is not null and c.mobile_e164 = p_mobile) or (p_cpf is not null and c.cpf = p_cpf)
          or (p_cnpj is not null and c.cnpj = p_cnpj) or (p_email is not null and c.email = p_email))
     and crm.can_see_contact(p_actor, p_role, c.id)
$$;

create or replace function crm.require_customer_fields(c crm.contacts) returns void
language plpgsql as $$
begin
  if c.mobile_e164 is null or c.mobile_e164 !~ '^\+55[1-9]{2}9[0-9]{8}$' then
    perform api.fail('VALIDATION_FAILED', jsonb_build_object('field', 'mobile_phone', 'reason', 'required_valid_br_mobile'));
  end if;
  if c.owner_id is null then
    perform api.fail('VALIDATION_FAILED', jsonb_build_object('field', 'owner_id', 'reason', 'required'));
  end if;
end $$;

create or replace function crm.check_birthday_not_future(p jsonb) returns void language plpgsql as $$
begin
  if (p->>'birthday_year') is not null and
     make_date((p->>'birthday_year')::int, (p->>'birthday_month')::int, (p->>'birthday_day')::int)
       > (now() at time zone 'America/Sao_Paulo')::date then
    perform api.fail('VALIDATION_FAILED', jsonb_build_object('field', 'birthday', 'reason', 'future_date'));
  end if;
exception when invalid_datetime_format or datetime_field_overflow then
  perform api.fail('VALIDATION_FAILED', jsonb_build_object('field', 'birthday', 'reason', 'invalid_date'));
end $$;

-- ---------------------------------------------------------------- contatos
create or replace function api.contact_list(p_actor uuid, p jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_role text := identity.require_actor(p_actor, 'crm.read');
  v_limit int := least(greatest(coalesce((p->>'limit')::int, 50), 1), 100);
  v_q text := nullif(btrim(p->>'q'), '');
  v_digits text := nullif(regexp_replace(coalesce(p->>'q', ''), '\D', '', 'g'), '');
  v_rows jsonb; v_more boolean;
begin
  if p->>'role' = 'SUPPLIER' and v_role <> 'OWNER' then perform api.fail('PERMISSION_DENIED'); end if;
  with page as (
    select c.* from crm.contacts c
     where c.merged_into_id is null
       and crm.can_see_contact(p_actor, v_role, c.id)
       and (p->>'role' is null or exists (select 1 from crm.contact_roles r where r.contact_id = c.id
                                           and r.role = p->>'role' and r.active))
       and (p->>'owner_id' is null or c.owner_id = (p->>'owner_id')::uuid)
       and (v_q is null or c.name ilike '%' || v_q || '%' or c.email ilike '%' || v_q || '%'
            or (v_digits is not null and length(v_digits) >= 4
                and (c.mobile_e164 like '%' || v_digits || '%' or c.cpf like v_digits || '%'
                     or c.cnpj like v_digits || '%' or regexp_replace(coalesce(c.phone, ''), '\D', '', 'g') like '%' || v_digits || '%')))
       and (p->>'cursor_created_at' is null or (c.created_at, c.id) <
            ((p->>'cursor_created_at')::timestamptz, (p->>'cursor_id')::uuid))
     order by c.created_at desc, c.id desc
     limit v_limit + 1)
  select coalesce(jsonb_agg(crm.contact_json(page, v_role) order by page.created_at desc, page.id desc), '[]'::jsonb),
         count(*) > v_limit
    into v_rows, v_more from page;
  if v_more then v_rows := v_rows - (jsonb_array_length(v_rows) - 1); end if;
  return jsonb_build_object('data', v_rows, 'has_more', v_more);
end $$;

create or replace function api.contact_get(p_actor uuid, p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_role text := identity.require_actor(p_actor, 'crm.read'); c crm.contacts%rowtype;
begin
  select * into c from crm.contacts where id = p_id;
  if not found or not crm.can_see_contact(p_actor, v_role, p_id) then perform api.fail('NOT_FOUND'); end if;
  return crm.contact_json(c, v_role) || jsonb_build_object(
    'merged_into_id', c.merged_into_id,
    'opportunities', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'title', o.title, 'stage_id', o.stage_id,
        'stage_name', s.name, 'stage_kind', s.kind, 'owner_id', o.owner_id, 'updated_at', o.updated_at)
        order by o.updated_at desc)
      from crm.opportunities o join crm.pipeline_stages s on s.id = o.stage_id
     where o.contact_id = p_id and crm.can_see_opportunity(p_actor, v_role, o.id)), '[]'::jsonb),
    'activities', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'kind', a.kind, 'body', a.body,
        'due_at', a.due_at, 'completed_at', a.completed_at, 'opportunity_id', a.opportunity_id,
        'author_name', pr.name, 'created_at', a.created_at) order by a.created_at desc)
      from crm.activities a join identity.profiles pr on pr.id = a.author_id
     where a.contact_id = p_id and (a.opportunity_id is null or crm.can_see_opportunity(p_actor, v_role, a.opportunity_id))),
     '[]'::jsonb),
    'possible_duplicates', crm.duplicates(p_actor, v_role, c.mobile_e164, c.cpf, c.email, c.cnpj, c.id));
end $$;

-- p: campos já normalizados pelo adaptador (mobile_e164, cpf, email, note, person_type, birthday_*).
create or replace function api.contact_create(p_ctx jsonb, p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (p_ctx->>'actor_id')::uuid;
  v_role text := identity.require_actor(v_actor, 'crm.write');
  c crm.contacts%rowtype;
begin
  perform crm.check_birthday_not_future(p);
  insert into crm.contacts (name, mobile_e164, cpf, email, note, person_type, birthday_day, birthday_month,
                            birthday_year, owner_id)
  values (btrim(p->>'name'), p->>'mobile_e164', p->>'cpf', p->>'email', p->>'note', p->>'person_type',
          (p->>'birthday_day')::smallint, (p->>'birthday_month')::smallint, (p->>'birthday_year')::smallint, v_actor)
  returning * into c;
  perform crm.require_customer_fields(c);
  insert into crm.contact_roles (contact_id, role) values (c.id, 'CUSTOMER');
  perform audit.record(p_ctx, 'contact.created', 'contact', c.id, jsonb_build_object('roles', array['CUSTOMER']));
  return jsonb_build_object('id', c.id, 'version', c.version,
    'possible_duplicates', crm.duplicates(v_actor, v_role, c.mobile_e164, c.cpf, c.email, null, c.id));
end $$;

create or replace function api.contact_update(p_ctx jsonb, p_id uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (p_ctx->>'actor_id')::uuid;
  v_role text := identity.require_actor(v_actor, 'crm.write');
  c crm.contacts%rowtype; v_new crm.contacts%rowtype; v_is_supplier boolean; v_is_customer boolean;
begin
  select * into c from crm.contacts where id = p_id for update;
  if not found or not crm.can_see_contact(v_actor, v_role, p_id) then perform api.fail('NOT_FOUND'); end if;
  if c.version <> (p->>'expected_version')::int then
    perform api.fail('VERSION_CONFLICT', jsonb_build_object('current_version', c.version));
  end if;
  select exists (select 1 from crm.contact_roles where contact_id = p_id and role = 'SUPPLIER' and active),
         exists (select 1 from crm.contact_roles where contact_id = p_id and role = 'CUSTOMER' and active)
    into v_is_supplier, v_is_customer;
  if (v_is_supplier or p ?| array['trade_name', 'cnpj', 'address']) and v_role <> 'OWNER' then
    perform api.fail('PERMISSION_DENIED', jsonb_build_object('permission', 'suppliers.write'));
  end if;
  if p ? 'owner_id' and v_role <> 'OWNER' then
    perform api.fail('PERMISSION_DENIED', jsonb_build_object('permission', 'crm.manage'));
  end if;
  if p ? 'birthday_day' then perform crm.check_birthday_not_future(p); end if;
  update crm.contacts set
    name = case when p ? 'name' then btrim(p->>'name') else name end,
    mobile_e164 = case when p ? 'mobile_e164' then p->>'mobile_e164' else mobile_e164 end,
    phone = case when p ? 'phone' then p->>'phone' else phone end,
    cpf = case when p ? 'cpf' then p->>'cpf' else cpf end,
    cnpj = case when p ? 'cnpj' then p->>'cnpj' else cnpj end,
    email = case when p ? 'email' then p->>'email' else email end,
    note = case when p ? 'note' then p->>'note' else note end,
    person_type = case when p ? 'person_type' then p->>'person_type' else person_type end,
    trade_name = case when p ? 'trade_name' then p->>'trade_name' else trade_name end,
    address = case when p ? 'address' then nullif(p->'address', 'null'::jsonb) else address end,
    owner_id = case when p ? 'owner_id' then (p->>'owner_id')::uuid else owner_id end,
    birthday_day = case when p ? 'birthday_day' then (p->>'birthday_day')::smallint else birthday_day end,
    birthday_month = case when p ? 'birthday_day' then (p->>'birthday_month')::smallint else birthday_month end,
    birthday_year = case when p ? 'birthday_day' then (p->>'birthday_year')::smallint else birthday_year end,
    version = version + 1, updated_at = now()
  where id = p_id returning * into v_new;
  if v_is_customer and not c.migration_pending then perform crm.require_customer_fields(v_new); end if;
  if v_is_supplier and v_new.person_type is null then
    perform api.fail('VALIDATION_FAILED', jsonb_build_object('field', 'person_type', 'reason', 'required_for_supplier'));
  end if;
  perform audit.record(p_ctx, 'contact.updated', 'contact', p_id,
    jsonb_build_object('fields', (select jsonb_agg(k) from jsonb_object_keys(p - 'expected_version') k)));
  return jsonb_build_object('id', p_id, 'version', v_new.version);
end $$;

create or replace function api.supplier_create(p_ctx jsonb, p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (p_ctx->>'actor_id')::uuid; v_role text := identity.require_actor(v_actor, 'suppliers.write');
        c crm.contacts%rowtype;
begin
  insert into crm.contacts (name, person_type, trade_name, mobile_e164, phone, cpf, cnpj, email, note, address, owner_id)
  values (btrim(p->>'name'), p->>'person_type', p->>'trade_name', p->>'mobile_e164', p->>'phone', p->>'cpf',
          p->>'cnpj', p->>'email', p->>'note', nullif(p->'address', 'null'::jsonb), v_actor)
  returning * into c;
  if c.person_type is null then
    perform api.fail('VALIDATION_FAILED', jsonb_build_object('field', 'person_type', 'reason', 'required'));
  end if;
  insert into crm.contact_roles (contact_id, role) values (c.id, 'SUPPLIER');
  perform audit.record(p_ctx, 'supplier.created', 'contact', c.id, '{}'::jsonb);
  return jsonb_build_object('id', c.id, 'version', c.version,
    'possible_duplicates', crm.duplicates(v_actor, v_role, c.mobile_e164, c.cpf, c.email, c.cnpj, c.id));
end $$;

-- Ativa papel no mesmo contato (sem duplicar pessoa); revalida campos exigidos pelo novo papel.
create or replace function api.contact_add_role(p_ctx jsonb, p_id uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (p_ctx->>'actor_id')::uuid; v_role text := identity.require_actor(v_actor, 'suppliers.write');
        c crm.contacts%rowtype;
begin
  select * into c from crm.contacts where id = p_id for update;
  if not found then perform api.fail('NOT_FOUND'); end if;
  if c.version <> (p->>'expected_version')::int then perform api.fail('VERSION_CONFLICT'); end if;
  update crm.contacts set
    mobile_e164 = coalesce(p->>'mobile_e164', mobile_e164),
    person_type = coalesce(p->>'person_type', person_type),
    owner_id = coalesce((p->>'owner_id')::uuid, owner_id, v_actor),
    version = version + 1, updated_at = now()
   where id = p_id returning * into c;
  if p->>'role' = 'CUSTOMER' then perform crm.require_customer_fields(c);
  elsif c.person_type is null then
    perform api.fail('VALIDATION_FAILED', jsonb_build_object('field', 'person_type', 'reason', 'required_for_supplier'));
  end if;
  insert into crm.contact_roles (contact_id, role) values (p_id, p->>'role')
  on conflict (contact_id, role) do update set active = true;
  perform audit.record(p_ctx, 'contact.role_added', 'contact', p_id, jsonb_build_object('role', p->>'role'));
  return jsonb_build_object('id', p_id, 'version', c.version);
end $$;

-- Aniversariantes: ocorrências locais (datas civis) entre p_from e p_to, somente PF confirmado.
create or replace function api.birthday_list(p_actor uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_role text := identity.require_actor(p_actor, 'crm.read');
begin
  if p_to < p_from or p_to - p_from > 366 then
    perform api.fail('VALIDATION_FAILED', jsonb_build_object('field', 'period', 'reason', 'max_366_days'));
  end if;
  return jsonb_build_object(
    'data', coalesce((
      select jsonb_agg(x order by x->>'sort_key', x->>'name') from (
        select jsonb_build_object('contact_id', c.id, 'name', c.name, 'mobile_phone', c.mobile_e164,
               'owner_name', pr.name, 'day', c.birthday_day, 'month', c.birthday_month,
               'occurrence_date', case when leap_gap then null else occ end,
               'leap_exception', leap_gap,
               'age', case when c.birthday_year is null or leap_gap then null else extract(year from occ)::int - c.birthday_year end,
               'sort_key', to_char(occ, 'YYYY-MM-DD')) as x, c.name
          from crm.contacts c
          left join identity.profiles pr on pr.id = c.owner_id
          cross join lateral (select generate_series(extract(year from p_from)::int, extract(year from p_to)::int) as y) ys
          cross join lateral (
            select case when c.birthday_month = 2 and c.birthday_day = 29
                         and not (ys.y % 4 = 0 and (ys.y % 100 <> 0 or ys.y % 400 = 0))
                        then make_date(ys.y, 2, 28) else make_date(ys.y, c.birthday_month, c.birthday_day) end as occ,
                   (c.birthday_month = 2 and c.birthday_day = 29
                    and not (ys.y % 4 = 0 and (ys.y % 100 <> 0 or ys.y % 400 = 0))) as leap_gap) o
         where c.birthday_month is not null and c.person_type = 'PF' and c.merged_into_id is null
           and o.occ between p_from and p_to
           and crm.can_see_contact(p_actor, v_role, c.id)) t), '[]'::jsonb),
    'pending_person_type', (select count(*) from crm.contacts c
       where c.birthday_month is not null and c.person_type is distinct from 'PF' and c.merged_into_id is null
         and crm.can_see_contact(p_actor, v_role, c.id)));
end $$;

-- ---------------------------------------------------------------- pipeline
create or replace function crm.opportunity_json(o crm.opportunities)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', o.id, 'contact_id', o.contact_id, 'contact_name', c.name,
    'mobile_phone', c.mobile_e164, 'stage_id', o.stage_id, 'position', o.position, 'owner_id', o.owner_id,
    'owner_name', pr.name, 'title', o.title, 'lost_reason', o.lost_reason, 'next_contact_at', o.next_contact_at,
    'interest_product_id', o.interest_product_id,
    'expected_value_cents', case when o.expected_value_cents is null then null else o.expected_value_cents::text end,
    'expected_purchase_date', o.expected_purchase_date, 'tags', to_jsonb(o.tags), 'source', o.source,
    'last_activity_at', (select max(a.created_at) from crm.activities a where a.opportunity_id = o.id),
    'version', o.version, 'created_at', o.created_at, 'updated_at', o.updated_at)
  from crm.contacts c, identity.profiles pr where c.id = o.contact_id and pr.id = o.owner_id
$$;

create or replace function crm.opp_filter(o crm.opportunities, p jsonb) returns boolean
language sql stable security definer set search_path = '' as $$
  select (p->>'owner_id' is null or o.owner_id = (p->>'owner_id')::uuid)
     and (p->>'source' is null or o.source = p->>'source')
     and (p->>'interest_product_id' is null or o.interest_product_id = (p->>'interest_product_id')::uuid)
     and (p->>'created_from' is null or o.created_at >= (p->>'created_from')::timestamptz)
     and (p->>'created_to' is null or o.created_at < (p->>'created_to')::timestamptz)
     and (nullif(btrim(p->>'q'), '') is null or exists (select 1 from crm.contacts c where c.id = o.contact_id and
          (c.name ilike '%' || btrim(p->>'q') || '%' or o.title ilike '%' || btrim(p->>'q') || '%'
           or (length(regexp_replace(p->>'q', '\D', '', 'g')) >= 4
               and c.mobile_e164 like '%' || regexp_replace(p->>'q', '\D', '', 'g') || '%'))))
$$;

-- Quadro: etapas ativas, total autorizado/filtrado por etapa e até p.limit cartões por etapa em ordem persistida.
create or replace function api.pipeline_board(p_actor uuid, p jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_role text := identity.require_actor(p_actor, 'crm.read');
        v_limit int := least(greatest(coalesce((p->>'limit')::int, 50), 1), 100);
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'position', s.position,
      'kind', s.kind, 'version', s.version, 'cards_version', s.cards_version,
      'total', (select count(*) from crm.opportunities o where o.stage_id = s.id
                 and crm.can_see_opportunity(p_actor, v_role, o.id) and crm.opp_filter(o, p)),
      'cards', coalesce((select jsonb_agg(crm.opportunity_json(o) order by o.position) from (
                 select * from crm.opportunities o where o.stage_id = s.id
                    and crm.can_see_opportunity(p_actor, v_role, o.id) and crm.opp_filter(o, p)
                    and (p->>'after_position' is null or o.position > (p->>'after_position')::int)
                  order by o.position limit v_limit) o), '[]'::jsonb)) order by s.position)
    from crm.pipeline_stages s where s.active
      and (p->>'stage_id' is null or s.id = (p->>'stage_id')::uuid)), '[]'::jsonb);
end $$;

create or replace function api.opportunity_get(p_actor uuid, p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_role text := identity.require_actor(p_actor, 'crm.read'); o crm.opportunities%rowtype;
begin
  select * into o from crm.opportunities where id = p_id;
  if not found or not crm.can_see_opportunity(p_actor, v_role, p_id) then perform api.fail('NOT_FOUND'); end if;
  return crm.opportunity_json(o) || jsonb_build_object(
    'stage', (select jsonb_build_object('id', s.id, 'name', s.name, 'kind', s.kind) from crm.pipeline_stages s where s.id = o.stage_id),
    'activities', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'kind', a.kind, 'body', a.body,
        'due_at', a.due_at, 'completed_at', a.completed_at, 'author_name', pr.name, 'created_at', a.created_at)
        order by a.created_at desc)
      from crm.activities a join identity.profiles pr on pr.id = a.author_id where a.opportunity_id = p_id), '[]'::jsonb),
    'history', coalesce((select jsonb_agg(jsonb_build_object('action', e.action, 'occurred_at', e.occurred_at,
        'actor_name', pr.name, 'details', e.before_after) order by e.occurred_at desc)
      from audit.audit_events e left join identity.profiles pr on pr.id = e.actor_id
     where e.resource_type = 'opportunity' and e.resource_id = p_id), '[]'::jsonb));
end $$;

create or replace function api.opportunity_create(p_ctx jsonb, p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (p_ctx->>'actor_id')::uuid; v_role text := identity.require_actor(v_actor, 'crm.write');
  v_contact crm.contacts%rowtype; v_stage crm.pipeline_stages%rowtype; v_owner uuid; v_id uuid; v_pos int;
begin
  select * into v_contact from crm.contacts where id = (p->>'contact_id')::uuid;
  if not found or not crm.can_see_contact(v_actor, v_role, v_contact.id) then perform api.fail('NOT_FOUND'); end if;
  if not exists (select 1 from crm.contact_roles where contact_id = v_contact.id and role = 'CUSTOMER' and active) then
    perform api.fail('VALIDATION_FAILED', jsonb_build_object('field', 'contact_id', 'reason', 'contact_not_customer'));
  end if;
  if v_contact.migration_pending then
    perform api.fail('VALIDATION_FAILED', jsonb_build_object('field', 'contact_id', 'reason', 'migration_pending'));
  end if;
  if p->>'owner_id' is not null and v_role <> 'OWNER' then perform api.fail('PERMISSION_DENIED'); end if;
  v_owner := coalesce((p->>'owner_id')::uuid, case when v_role = 'OWNER' then coalesce(v_contact.owner_id, v_actor) else v_actor end);
  if p->>'stage_id' is not null then
    select * into v_stage from crm.pipeline_stages where id = (p->>'stage_id')::uuid and active for update;
  else
    select * into v_stage from crm.pipeline_stages where active and kind = 'OPEN' order by position limit 1 for update;
  end if;
  if not found then perform api.fail('VALIDATION_FAILED', jsonb_build_object('field', 'stage_id')); end if;
  if v_stage.kind = 'LOST' then
    perform api.fail('VALIDATION_FAILED', jsonb_build_object('field', 'stage_id', 'reason', 'cannot_create_lost'));
  end if;
  select coalesce(max(position) + 1, 0) into v_pos from crm.opportunities where stage_id = v_stage.id;
  insert into crm.opportunities (contact_id, stage_id, position, owner_id, title, interest_product_id,
                                 expected_value_cents, expected_purchase_date, tags, source)
  values (v_contact.id, v_stage.id, v_pos, v_owner, coalesce(nullif(btrim(p->>'title'), ''), v_contact.name),
          (p->>'interest_product_id')::uuid, (p->>'expected_value_cents')::bigint, (p->>'expected_purchase_date')::date,
          coalesce((select array_agg(t) from jsonb_array_elements_text(p->'tags') t), '{}'), coalesce(p->>'source', 'manual'))
  returning id into v_id;
  update crm.pipeline_stages set cards_version = cards_version + 1 where id = v_stage.id;
  perform audit.record(p_ctx, 'opportunity.created', 'opportunity', v_id, jsonb_build_object('stage', v_stage.name));
  return jsonb_build_object('id', v_id, 'version', 1);
end $$;

create or replace function api.opportunity_update(p_ctx jsonb, p_id uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (p_ctx->>'actor_id')::uuid; v_role text := identity.require_actor(v_actor, 'crm.write');
        o crm.opportunities%rowtype;
begin
  select * into o from crm.opportunities where id = p_id for update;
  if not found or not crm.can_see_opportunity(v_actor, v_role, p_id) then perform api.fail('NOT_FOUND'); end if;
  if o.version <> (p->>'expected_version')::int then
    perform api.fail('VERSION_CONFLICT', jsonb_build_object('current_version', o.version));
  end if;
  if p ? 'owner_id' and v_role <> 'OWNER' then
    perform api.fail('PERMISSION_DENIED', jsonb_build_object('permission', 'crm.manage'));
  end if;
  update crm.opportunities set
    title = case when p ? 'title' then btrim(p->>'title') else title end,
    owner_id = case when p ? 'owner_id' then (p->>'owner_id')::uuid else owner_id end,
    interest_product_id = case when p ? 'interest_product_id' then (p->>'interest_product_id')::uuid else interest_product_id end,
    expected_value_cents = case when p ? 'expected_value_cents' then (p->>'expected_value_cents')::bigint else expected_value_cents end,
    expected_purchase_date = case when p ? 'expected_purchase_date' then (p->>'expected_purchase_date')::date else expected_purchase_date end,
    next_contact_at = case when p ? 'next_contact_at' then (p->>'next_contact_at')::timestamptz else next_contact_at end,
    tags = case when p ? 'tags' then coalesce((select array_agg(t) from jsonb_array_elements_text(p->'tags') t), '{}') else tags end,
    version = version + 1, updated_at = now()
  where id = p_id;
  perform audit.record(p_ctx, 'opportunity.updated', 'opportunity', p_id,
    jsonb_build_object('fields', (select jsonb_agg(k) from jsonb_object_keys(p - 'expected_version') k)));
  return jsonb_build_object('id', p_id, 'version', o.version + 1);
end $$;

-- Renumera a etapa colocando p_moved (se não nulo) no índice calculado pela âncora.
create or replace function crm.renumber_stage(p_stage uuid, p_moved uuid, p_before uuid, p_after uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_ids uuid[]; v_idx int;
begin
  select coalesce(array_agg(id order by position, id), '{}') into v_ids
    from crm.opportunities where stage_id = p_stage and id is distinct from p_moved;
  if p_moved is not null then
    if p_before is not null then
      v_idx := array_position(v_ids, p_before);
      if v_idx is null then perform api.fail('VERSION_CONFLICT', jsonb_build_object('reason', 'anchor_not_in_stage')); end if;
      v_ids := v_ids[1:v_idx - 1] || p_moved || v_ids[v_idx:];
    elsif p_after is not null then
      v_idx := array_position(v_ids, p_after);
      if v_idx is null then perform api.fail('VERSION_CONFLICT', jsonb_build_object('reason', 'anchor_not_in_stage')); end if;
      v_ids := v_ids[1:v_idx] || p_moved || v_ids[v_idx + 1:];
    else
      v_ids := v_ids || p_moved;
    end if;
  end if;
  update crm.opportunities o set position = x.ord - 1, stage_id = p_stage
    from unnest(v_ids) with ordinality as x(id, ord)
   where o.id = x.id and (o.position <> x.ord - 1 or o.stage_id <> p_stage);
end $$;

create or replace function api.opportunity_move(p_ctx jsonb, p_id uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (p_ctx->>'actor_id')::uuid; v_role text := identity.require_actor(v_actor, 'crm.write');
  o crm.opportunities%rowtype; v_src crm.pipeline_stages%rowtype; v_dst crm.pipeline_stages%rowtype;
  v_target uuid := (p->>'stage_id')::uuid;
begin
  select * into o from crm.opportunities where id = p_id;
  if not found or not crm.can_see_opportunity(v_actor, v_role, p_id) then perform api.fail('NOT_FOUND'); end if;
  -- Trava etapas em ordem estável de ID para evitar deadlock entre movimentos cruzados.
  perform 1 from crm.pipeline_stages where id in (o.stage_id, v_target) order by id for update;
  select * into o from crm.opportunities where id = p_id for update;
  if o.version <> (p->>'expected_version')::int then
    perform api.fail('VERSION_CONFLICT', jsonb_build_object('resource', 'opportunity', 'current_version', o.version));
  end if;
  select * into v_src from crm.pipeline_stages where id = o.stage_id;
  select * into v_dst from crm.pipeline_stages where id = v_target and active;
  if not found then perform api.fail('NOT_FOUND', jsonb_build_object('resource', 'stage')); end if;
  if v_dst.version <> (p->>'expected_stage_version')::int
     or v_src.cards_version <> (p->>'expected_source_cards_version')::bigint
     or v_dst.cards_version <> (p->>'expected_target_cards_version')::bigint then
    perform api.fail('VERSION_CONFLICT', jsonb_build_object('resource', 'stage'));
  end if;
  if v_dst.kind = 'LOST' and v_src.kind <> 'LOST' and nullif(btrim(p->>'loss_reason'), '') is null then
    perform api.fail('VALIDATION_FAILED', jsonb_build_object('field', 'loss_reason', 'reason', 'required'));
  end if;
  update crm.opportunities set stage_id = v_dst.id, position = 2147483000,
         lost_reason = case when v_dst.kind = 'LOST' then coalesce(nullif(btrim(p->>'loss_reason'), ''), lost_reason) else null end,
         version = version + 1, updated_at = now()
   where id = p_id;
  perform crm.renumber_stage(v_dst.id, p_id, (p->>'before_opportunity_id')::uuid, (p->>'after_opportunity_id')::uuid);
  if v_src.id <> v_dst.id then perform crm.renumber_stage(v_src.id, null, null, null); end if;
  update crm.pipeline_stages set cards_version = cards_version + 1 where id in (v_src.id, v_dst.id);
  perform audit.record(p_ctx, 'opportunity.moved', 'opportunity', p_id,
    jsonb_build_object('from', v_src.name, 'to', v_dst.name, 'loss_reason', nullif(btrim(p->>'loss_reason'), '')));
  return jsonb_build_object('id', p_id, 'version', o.version + 1,
    'stages', (select jsonb_agg(jsonb_build_object('id', id, 'cards_version', cards_version))
                 from crm.pipeline_stages where id in (v_src.id, v_dst.id)));
end $$;

create or replace function api.activity_create(p_ctx jsonb, p_opp uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (p_ctx->>'actor_id')::uuid; v_role text := identity.require_actor(v_actor, 'crm.write');
        o crm.opportunities%rowtype; v_id uuid;
begin
  select * into o from crm.opportunities where id = p_opp;
  if not found or not crm.can_see_opportunity(v_actor, v_role, p_opp) then perform api.fail('NOT_FOUND'); end if;
  insert into crm.activities (contact_id, opportunity_id, author_id, kind, body, due_at)
  values (o.contact_id, o.id, v_actor, p->>'kind', btrim(p->>'body'), (p->>'due_at')::timestamptz)
  returning id into v_id;
  if p->>'due_at' is not null then
    update crm.opportunities set next_contact_at = (p->>'due_at')::timestamptz, updated_at = now() where id = p_opp;
  end if;
  return jsonb_build_object('id', v_id);
end $$;

create or replace function api.activity_complete(p_ctx jsonb, p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (p_ctx->>'actor_id')::uuid; v_role text := identity.require_actor(v_actor, 'crm.write');
        a crm.activities%rowtype;
begin
  select * into a from crm.activities where id = p_id for update;
  if not found or (a.opportunity_id is not null and not crm.can_see_opportunity(v_actor, v_role, a.opportunity_id))
     or (a.opportunity_id is null and not crm.can_see_contact(v_actor, v_role, a.contact_id)) then
    perform api.fail('NOT_FOUND');
  end if;
  if a.completed_at is null then
    update crm.activities set completed_at = now(), completed_by = v_actor where id = p_id;
  end if;
  return jsonb_build_object('id', p_id);
end $$;

-- Tarefas humanas pendentes no escopo (próximas ações).
create or replace function api.activity_agenda(p_actor uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_role text := identity.require_actor(p_actor, 'crm.read');
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'kind', a.kind, 'body', a.body, 'due_at', a.due_at,
      'opportunity_id', a.opportunity_id, 'contact_id', a.contact_id, 'contact_name', c.name) order by a.due_at)
    from (select * from crm.activities a where a.completed_at is null and a.due_at is not null
            and (a.opportunity_id is null or crm.can_see_opportunity(p_actor, v_role, a.opportunity_id))
            and crm.can_see_contact(p_actor, v_role, a.contact_id)
          order by a.due_at limit 50) a join crm.contacts c on c.id = a.contact_id), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------- etapas (OWNER)
create or replace function api.stage_create(p_ctx jsonb, p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (p_ctx->>'actor_id')::uuid; v_id uuid; v_pos int; v_max int;
begin
  perform identity.require_actor(v_actor, 'pipeline.manage');
  perform pg_advisory_xact_lock(hashtextextended('crm.pipeline', 0));
  select coalesce(max(position) + 1, 0) into v_max from crm.pipeline_stages where active;
  v_pos := least(greatest((p->>'position')::int, 0), v_max);
  -- Deslocamento temporário fora da faixa evita colisão no índice único parcial durante a renumeração.
  update crm.pipeline_stages set position = position + 100000 where active and position >= v_pos;
  update crm.pipeline_stages set position = position - 100000 + 1, version = version + 1 where active and position >= 100000;
  insert into crm.pipeline_stages (name, position, kind) values (btrim(p->>'name'), v_pos, p->>'kind') returning id into v_id;
  perform audit.record(p_ctx, 'stage.created', 'pipeline_stage', v_id, jsonb_build_object('name', p->>'name'));
  return jsonb_build_object('id', v_id, 'version', 1);
end $$;

create or replace function api.stage_update(p_ctx jsonb, p_id uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (p_ctx->>'actor_id')::uuid; s crm.pipeline_stages%rowtype;
begin
  perform identity.require_actor(v_actor, 'pipeline.manage');
  select * into s from crm.pipeline_stages where id = p_id and active for update;
  if not found then perform api.fail('NOT_FOUND'); end if;
  if s.version <> (p->>'expected_version')::int then perform api.fail('VERSION_CONFLICT'); end if;
  update crm.pipeline_stages set name = coalesce(btrim(p->>'name'), name), version = version + 1, updated_at = now()
   where id = p_id;
  perform audit.record(p_ctx, 'stage.renamed', 'pipeline_stage', p_id,
    jsonb_build_object('before', s.name, 'after', p->>'name'));
  return jsonb_build_object('id', p_id, 'version', s.version + 1);
end $$;

create or replace function api.stage_archive(p_ctx jsonb, p_id uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (p_ctx->>'actor_id')::uuid; s crm.pipeline_stages%rowtype;
begin
  perform identity.require_actor(v_actor, 'pipeline.manage');
  perform pg_advisory_xact_lock(hashtextextended('crm.pipeline', 0));
  select * into s from crm.pipeline_stages where id = p_id and active for update;
  if not found then perform api.fail('NOT_FOUND'); end if;
  if s.version <> (p->>'expected_version')::int then perform api.fail('VERSION_CONFLICT'); end if;
  if exists (select 1 from crm.opportunities where stage_id = p_id) then
    perform api.fail('VALIDATION_FAILED', jsonb_build_object('reason', 'stage_not_empty'));
  end if;
  if not exists (select 1 from crm.pipeline_stages where active and kind = s.kind and id <> p_id) then
    perform api.fail('VALIDATION_FAILED', jsonb_build_object('reason', 'last_stage_of_kind'));
  end if;
  update crm.pipeline_stages set active = false, version = version + 1, updated_at = now() where id = p_id;
  update crm.pipeline_stages set position = position + 100000 where active and position > s.position;
  update crm.pipeline_stages set position = position - 100000 - 1, version = version + 1 where active and position >= 100000;
  perform audit.record(p_ctx, 'stage.archived', 'pipeline_stage', p_id, jsonb_build_object('name', s.name));
  return jsonb_build_object('id', p_id, 'version', s.version + 1);
end $$;

-- Recebe a lista completa de etapas ativas na nova ordem, com versões; revalida sob o lock do pipeline.
create or replace function api.stage_reorder(p_ctx jsonb, p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (p_ctx->>'actor_id')::uuid; v_count int; v_match int;
begin
  perform identity.require_actor(v_actor, 'pipeline.manage');
  perform pg_advisory_xact_lock(hashtextextended('crm.pipeline', 0));
  perform 1 from crm.pipeline_stages where active order by id for update;
  select count(*) into v_count from crm.pipeline_stages where active;
  select count(*) into v_match from jsonb_array_elements(p->'stages') e
    join crm.pipeline_stages s on s.id = (e->>'id')::uuid and s.active and s.version = (e->>'expected_version')::int;
  if v_count <> jsonb_array_length(p->'stages') or v_match <> v_count then
    perform api.fail('VERSION_CONFLICT', jsonb_build_object('resource', 'pipeline'));
  end if;
  update crm.pipeline_stages set position = position + 100000 where active;
  update crm.pipeline_stages s set position = x.ord - 1, version = version + 1, updated_at = now()
    from jsonb_array_elements(p->'stages') with ordinality as x(e, ord) where s.id = (x.e->>'id')::uuid;
  perform audit.record(p_ctx, 'pipeline.reordered', 'pipeline_stage', null, p);
  return jsonb_build_object('stages', (select jsonb_agg(jsonb_build_object('id', id, 'version', version) order by position)
                                         from crm.pipeline_stages where active));
end $$;

-- ---------------------------------------------------------------- configurações e captura pública
create or replace function api.crm_settings(p_actor uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform identity.require_actor(p_actor, 'crm.manage');
  return (select jsonb_build_object('default_lead_owner_id', default_lead_owner_id, 'version', version) from crm.settings);
end $$;

create or replace function api.crm_settings_update(p_ctx jsonb, p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (p_ctx->>'actor_id')::uuid; v crm.settings%rowtype;
begin
  perform identity.require_actor(v_actor, 'crm.manage');
  select * into v from crm.settings for update;
  if v.version <> (p->>'expected_version')::int then perform api.fail('VERSION_CONFLICT'); end if;
  if p->>'default_lead_owner_id' is not null and not exists (select 1 from identity.profiles
       where id = (p->>'default_lead_owner_id')::uuid and active) then
    perform api.fail('VALIDATION_FAILED', jsonb_build_object('field', 'default_lead_owner_id'));
  end if;
  update crm.settings set default_lead_owner_id = (p->>'default_lead_owner_id')::uuid, version = version + 1, updated_at = now();
  perform audit.record(p_ctx, 'crm.settings_updated', 'crm_settings', null, p);
  return jsonb_build_object('version', v.version + 1);
end $$;

-- Formulário público: idempotente por submission_id; não mescla pessoas por telefone; resposta sem PII.
create or replace function api.lead_submit(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_sub crm.lead_submissions%rowtype; v_owner uuid; c crm.contacts%rowtype; v_stage crm.pipeline_stages%rowtype;
        v_opp uuid; v_recent int;
begin
  perform pg_advisory_xact_lock(hashtextextended('lead:' || (p->>'submission_id'), 0));
  select * into v_sub from crm.lead_submissions where submission_id = (p->>'submission_id')::uuid;
  if found then
    if v_sub.request_hash <> p->>'request_hash' then perform api.fail('IDEMPOTENCY_CONFLICT'); end if;
    return jsonb_build_object('submission_id', v_sub.submission_id, 'replayed', true);
  end if;
  if p->>'client_hash' is not null then
    select count(*) into v_recent from crm.lead_submissions
     where client_hash = p->>'client_hash' and received_at > now() - interval '10 minutes';
    if v_recent >= 5 then perform api.fail('RATE_LIMITED'); end if;
  end if;
  select default_lead_owner_id into v_owner from crm.settings s
   where exists (select 1 from identity.profiles pr where pr.id = s.default_lead_owner_id and pr.active);
  if v_owner is null then perform api.fail('CAPABILITY_UNAVAILABLE', jsonb_build_object('reason', 'lead_owner_not_configured')); end if;
  insert into crm.contacts (name, mobile_e164, cpf, email, note, person_type, birthday_day, birthday_month, birthday_year, owner_id)
  values (btrim(p->>'name'), p->>'mobile_e164', p->>'cpf', p->>'email', p->>'note', p->>'person_type',
          (p->>'birthday_day')::smallint, (p->>'birthday_month')::smallint, (p->>'birthday_year')::smallint, v_owner)
  returning * into c;
  perform crm.require_customer_fields(c);
  insert into crm.contact_roles (contact_id, role) values (c.id, 'CUSTOMER');
  insert into crm.lead_submissions (submission_id, request_hash, contact_id, source, utm, client_hash)
  values ((p->>'submission_id')::uuid, p->>'request_hash', c.id, 'landing', nullif(p->'utm', 'null'::jsonb), p->>'client_hash');
  select * into v_stage from crm.pipeline_stages where active and kind = 'OPEN' order by position limit 1 for update;
  insert into crm.opportunities (contact_id, stage_id, position, owner_id, title, source, source_submission_id)
  values (c.id, v_stage.id, (select coalesce(max(position) + 1, 0) from crm.opportunities where stage_id = v_stage.id),
          v_owner, c.name, 'landing', (p->>'submission_id')::uuid)
  returning id into v_opp;
  update crm.pipeline_stages set cards_version = cards_version + 1 where id = v_stage.id;
  update crm.lead_submissions set opportunity_id = v_opp where submission_id = (p->>'submission_id')::uuid;
  insert into audit.audit_events (actor_kind, action, resource_type, resource_id, decision, before_after)
  values ('SYSTEM', 'lead.submitted', 'contact', c.id, 'ALLOW', jsonb_build_object('source', 'landing'));
  return jsonb_build_object('submission_id', p->>'submission_id', 'replayed', false);
end $$;
