-- NINEBIKE OS — integração da IA do WhatsApp (n8n) e comissão da equipe (T16).
--
-- Integração IA: decisão explícita do responsável em 24/11/2026, substituindo a restrição
-- "não provisionar credencial n8n" do contracts/api.md. Escopo mínimo e fechado:
--   * chave de API própria por integração (só o hash SHA-256 é guardado; o segredo aparece uma vez);
--   * escopos: catalog.read (produtos, preço e disponibilidade, sem custo/fornecedor),
--              customers.read (cliente pelo celular: nome, vendedor, etapa, pedidos resumidos),
--              leads.write (registrar lead/anotação vinda do WhatsApp);
--   * nenhuma rota financeira, fiscal, de estoque (escrita), de usuários ou de custo;
--   * revogável na hora; uso registrado; limite de requisições por minuto.
--
-- Comissão da equipe: regra versionada criada pelo OWNER (percentual em pontos-base, padrão e
-- por vendedor). Ao confirmar um pedido, grava-se um lançamento com snapshot da regra vigente.
-- Sem regra vigente não há lançamento (nenhum valor presumido). Cancelamento estorna o lançamento.
-- Pagamento ao vendedor é marcado manualmente pelo OWNER (sem transferência automática).

-- ============================================================ integração IA
create table integrations.agent_clients (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> '' and length(name) <= 80),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  token_prefix text not null,
  scopes text[] not null check (scopes <@ array['catalog.read','customers.read','leads.write']::text[] and cardinality(scopes) > 0),
  created_by uuid not null references identity.profiles(id),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references identity.profiles(id),
  last_used_at timestamptz
);

create table integrations.agent_requests (
  id bigint generated always as identity primary key,
  client_id uuid not null references integrations.agent_clients(id),
  action text not null,
  at timestamptz not null default now()
);
create index agent_requests_rate on integrations.agent_requests (client_id, at desc);

create table integrations.agent_lead_events (
  event_id uuid primary key,
  client_id uuid not null references integrations.agent_clients(id),
  request_hash text not null,
  contact_id uuid not null references crm.contacts(id),
  opportunity_id uuid references crm.opportunities(id),
  created_contact boolean not null,
  received_at timestamptz not null default now()
);

-- Autentica pelo hash, confere escopo, aplica limite (120/min) e registra uso. Falha fechada.
create or replace function integrations.agent_require(p_token_hash text, p_scope text, p_action text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v integrations.agent_clients%rowtype; v_n int;
begin
  select * into v from integrations.agent_clients where token_hash = p_token_hash and revoked_at is null;
  if not found then perform api.fail('AUTH_REQUIRED'); end if;
  if not (p_scope = any(v.scopes)) then
    perform api.fail('PERMISSION_DENIED', jsonb_build_object('scope', p_scope));
  end if;
  select count(*) into v_n from integrations.agent_requests where client_id = v.id and at > now() - interval '1 minute';
  if v_n >= 120 then perform api.fail('RATE_LIMITED'); end if;
  insert into integrations.agent_requests (client_id, action) values (v.id, p_action);
  update integrations.agent_clients set last_used_at = now() where id = v.id;
  return v.id;
end $$;

-- Administração das chaves (OWNER).
create or replace function api.agent_client_list(p_actor uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform identity.require_actor(p_actor, 'users.manage');
  return coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'token_prefix', c.token_prefix,
      'scopes', to_jsonb(c.scopes), 'created_at', c.created_at, 'created_by_name', pr.name,
      'revoked_at', c.revoked_at, 'last_used_at', c.last_used_at,
      'requests_24h', (select count(*) from integrations.agent_requests r where r.client_id = c.id and r.at > now() - interval '24 hours'))
    order by c.revoked_at nulls first, c.created_at desc)
    from integrations.agent_clients c join identity.profiles pr on pr.id = c.created_by), '[]'::jsonb);
end $$;

create or replace function api.agent_client_create(p_ctx jsonb, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (p_ctx->>'actor_id')::uuid; v_id uuid; v_scopes text[];
begin
  perform identity.require_actor(v_actor, 'users.manage');
  if not coalesce((p_ctx->>'mfa_recent')::boolean, false) then perform api.fail('MFA_RECENCY_REQUIRED'); end if;
  select array_agg(distinct s order by s) into v_scopes from jsonb_array_elements_text(p->'scopes') s;
  insert into integrations.agent_clients (name, token_hash, token_prefix, scopes, created_by)
  values (btrim(p->>'name'), p->>'token_hash', p->>'token_prefix', v_scopes, v_actor)
  returning id into v_id;
  perform audit.record(p_ctx, 'agent_client.created', 'agent_client', v_id,
    jsonb_build_object('name', btrim(p->>'name'), 'scopes', to_jsonb(v_scopes)));
  -- O segredo não entra no recibo de idempotência: o Worker o devolve fora do corpo gravado.
  return jsonb_build_object('id', v_id, 'name', btrim(p->>'name'), 'scopes', to_jsonb(v_scopes), 'token_prefix', p->>'token_prefix');
end $$;

create or replace function api.agent_client_revoke(p_ctx jsonb, p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (p_ctx->>'actor_id')::uuid;
begin
  perform identity.require_actor(v_actor, 'users.manage');
  update integrations.agent_clients set revoked_at = coalesce(revoked_at, now()), revoked_by = coalesce(revoked_by, v_actor)
   where id = p_id;
  if not found then perform api.fail('NOT_FOUND'); end if;
  perform audit.record(p_ctx, 'agent_client.revoked', 'agent_client', p_id, '{}'::jsonb);
  return jsonb_build_object('id', p_id, 'revoked', true);
end $$;

-- Projeção comercial para a IA: sem custo, fornecedor, unidades/séries ou movimentos.
create or replace function integrations.agent_product_json(p inventory.products) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', p.id, 'name', p.name, 'sku', p.sku,
    'type', case p.tracking when 'UNIT' then 'BIKE' else 'ACCESSORY' end,
    'brand', p.brand, 'category', p.category, 'size', p.size, 'color', p.color,
    'variant_description', p.variant_description, 'warranty_note', p.warranty_note,
    'price_cents', case when p.sale_price_cents is null then null else p.sale_price_cents::text end,
    'price_display', case when p.sale_price_cents is null then null
       else 'R$ ' || replace(replace(replace(to_char(p.sale_price_cents / 100.0, 'FM999G999G990D00'), ',', '#'), '.', ','), '#', '.') end,
    'stock', case when (inventory.counts(p)->>'known')::boolean
       then jsonb_build_object('known', true, 'available', (inventory.counts(p)->>'available')::int,
                               'in_stock', (inventory.counts(p)->>'available')::int > 0)
       else jsonb_build_object('known', false, 'available', null, 'in_stock', null) end)
$$;

create or replace function api.agent_products_search(p_token_hash text, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_q text := nullif(btrim(p->>'q'), ''); v_limit int := least(greatest(coalesce((p->>'limit')::int, 10), 1), 30);
        v_only boolean := coalesce((p->>'only_available')::boolean, false);
begin
  perform integrations.agent_require(p_token_hash, 'catalog.read', 'products.search');
  return coalesce((select jsonb_agg(integrations.agent_product_json(x) order by x.name) from (
    select x.* from inventory.products x
     where x.active and x.tracking is not null
       and (v_q is null or exists (select 1 from regexp_split_to_table(lower(v_q), '\s+') w
             where w <> '' and (lower(x.name) like '%' || w || '%' or lower(coalesce(x.brand, '')) like '%' || w || '%'
                   or lower(coalesce(x.category, '')) like '%' || w || '%' or lower(x.sku) like '%' || w || '%'
                   or lower(coalesce(x.color, '')) like '%' || w || '%')))
       and (p->>'type' is null or x.tracking = case p->>'type' when 'BIKE' then 'UNIT' else 'QUANTITY' end)
       and (not v_only or coalesce((inventory.counts(x)->>'available')::int, 0) > 0)
     order by (v_q is not null and lower(x.name) like '%' || lower(v_q) || '%') desc, x.name
     limit v_limit) x), '[]'::jsonb);
end $$;

create or replace function api.agent_product_get(p_token_hash text, p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare x inventory.products%rowtype;
begin
  perform integrations.agent_require(p_token_hash, 'catalog.read', 'products.get');
  select * into x from inventory.products where id = p_id and active and tracking is not null;
  if not found then perform api.fail('NOT_FOUND'); end if;
  return integrations.agent_product_json(x);
end $$;

-- Cliente pelo celular (E.164). Só o necessário para atender: nada de CPF, e-mail, endereço ou custo.
create or replace function api.agent_customer_by_phone(p_token_hash text, p_phone text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c crm.contacts%rowtype;
begin
  perform integrations.agent_require(p_token_hash, 'customers.read', 'customers.by_phone');
  select * into c from crm.contacts where mobile_e164 = p_phone order by created_at limit 1;
  if not found then return jsonb_build_object('found', false); end if;
  return jsonb_build_object('found', true, 'customer', jsonb_build_object(
    'id', c.id, 'name', c.name, 'first_name', split_part(btrim(c.name), ' ', 1),
    'seller_name', (select name from identity.profiles where id = c.owner_id),
    'birthday_today', (c.birthday_day = extract(day from (now() at time zone 'America/Sao_Paulo'))
                       and c.birthday_month = extract(month from (now() at time zone 'America/Sao_Paulo'))),
    'open_opportunities', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'title', o.title, 'stage', s.name,
         'interest_product', (select name from inventory.products where id = o.interest_product_id),
         'updated_at', o.updated_at) order by o.updated_at desc)
       from crm.opportunities o join crm.pipeline_stages s on s.id = o.stage_id
      where o.contact_id = c.id and s.kind = 'OPEN'), '[]'::jsonb),
    'recent_orders', coalesce((select jsonb_agg(x order by x->>'confirmed_at' desc) from (
        select jsonb_build_object('number', o.display_number, 'confirmed_at', o.confirmed_at, 'state', o.commercial_state,
          'delivery_state', o.delivery_state, 'total_cents', o.total_cents::text,
          'items', (select jsonb_agg(i.description_snapshot order by i.position) from sales.order_items i where i.order_id = o.id)) x
          from sales.orders o where o.contact_id = c.id order by o.confirmed_at desc limit 5) t), '[]'::jsonb)));
end $$;

-- Lead/anotação vinda do WhatsApp. event_id idempotente; mesmo celular não duplica contato.
create or replace function api.agent_lead_upsert(p_token_hash text, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_client uuid; v_ev integrations.agent_lead_events%rowtype; c crm.contacts%rowtype; v_owner uuid;
        v_stage crm.pipeline_stages%rowtype; v_opp uuid; v_created boolean := false; v_note text := nullif(btrim(p->>'note'), '');
begin
  v_client := integrations.agent_require(p_token_hash, 'leads.write', 'leads.upsert');
  perform pg_advisory_xact_lock(hashtextextended('agent-lead:' || (p->>'mobile_e164'), 0));
  select * into v_ev from integrations.agent_lead_events where event_id = (p->>'event_id')::uuid;
  if found then
    if v_ev.request_hash <> p->>'request_hash' then perform api.fail('IDEMPOTENCY_CONFLICT'); end if;
    return jsonb_build_object('contact_id', v_ev.contact_id, 'opportunity_id', v_ev.opportunity_id,
                              'created_contact', v_ev.created_contact, 'replayed', true);
  end if;
  select * into c from crm.contacts where mobile_e164 = p->>'mobile_e164' order by created_at limit 1;
  if not found then
    select default_lead_owner_id into v_owner from crm.settings s
     where exists (select 1 from identity.profiles pr where pr.id = s.default_lead_owner_id and pr.active);
    if v_owner is null then perform api.fail('CAPABILITY_UNAVAILABLE', jsonb_build_object('reason', 'lead_owner_not_configured')); end if;
    insert into crm.contacts (name, mobile_e164, owner_id, note)
    values (btrim(p->>'name'), p->>'mobile_e164', v_owner, null) returning * into c;
    perform crm.require_customer_fields(c);
    insert into crm.contact_roles (contact_id, role) values (c.id, 'CUSTOMER');
    v_created := true;
  else
    insert into crm.contact_roles (contact_id, role) values (c.id, 'CUSTOMER') on conflict do nothing;
  end if;
  -- Reaproveita a oportunidade aberta mais recente; senão abre uma na primeira etapa.
  select o.id into v_opp from crm.opportunities o join crm.pipeline_stages s on s.id = o.stage_id
   where o.contact_id = c.id and s.kind = 'OPEN' order by o.updated_at desc limit 1;
  if v_opp is null then
    select * into v_stage from crm.pipeline_stages where active and kind = 'OPEN' order by position limit 1 for update;
    insert into crm.opportunities (contact_id, stage_id, position, owner_id, title, source, interest_product_id)
    values (c.id, v_stage.id, (select coalesce(max(position) + 1, 0) from crm.opportunities where stage_id = v_stage.id),
            c.owner_id, c.name, 'whatsapp_ai',
            (select id from inventory.products where id = nullif(p->>'interest_product_id', '')::uuid))
    returning id into v_opp;
    update crm.pipeline_stages set cards_version = cards_version + 1 where id = v_stage.id;
  elsif p->>'interest_product_id' is not null then
    update crm.opportunities set interest_product_id = coalesce(interest_product_id,
        (select id from inventory.products where id = (p->>'interest_product_id')::uuid)), updated_at = now()
     where id = v_opp;
  end if;
  if v_note is not null then
    insert into crm.activities (contact_id, opportunity_id, author_id, kind, body)
    values (c.id, v_opp, c.owner_id, 'NOTE', left('[IA WhatsApp] ' || v_note, 5000));
  end if;
  insert into integrations.agent_lead_events (event_id, client_id, request_hash, contact_id, opportunity_id, created_contact)
  values ((p->>'event_id')::uuid, v_client, p->>'request_hash', c.id, v_opp, v_created);
  insert into audit.audit_events (actor_kind, action, resource_type, resource_id, decision, before_after)
  values ('SYSTEM', 'agent.lead_upsert', 'contact', c.id, 'ALLOW',
          jsonb_build_object('client_id', v_client, 'created_contact', v_created));
  return jsonb_build_object('contact_id', c.id, 'opportunity_id', v_opp, 'created_contact', v_created, 'replayed', false);
end $$;

-- ============================================================ comissão da equipe (T16)
create table finance.staff_commission_rules (
  id uuid primary key default gen_random_uuid(),
  version integer not null unique,
  default_bps integer not null check (default_bps between 0 and 3000),
  overrides jsonb not null default '{}'::jsonb, -- {profile_id: bps}
  base text not null default 'ORDER_TOTAL_EXCL_FREIGHT' check (base in ('ORDER_TOTAL_EXCL_FREIGHT')),
  effective_from timestamptz not null default now(),
  note text,
  created_by uuid not null references identity.profiles(id),
  created_at timestamptz not null default now()
);

create table finance.staff_commission_entries (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references sales.orders(id),
  seller_id uuid not null references identity.profiles(id),
  rule_id uuid not null references finance.staff_commission_rules(id),
  base_cents bigint not null check (base_cents >= 0),
  bps integer not null,
  amount_cents bigint not null check (amount_cents >= 0),
  state text not null default 'ACCRUED' check (state in ('ACCRUED', 'PAID', 'REVERSED')),
  paid_at timestamptz, paid_by uuid references identity.profiles(id), paid_note text,
  reversed_at timestamptz,
  created_at timestamptz not null default now()
);
create index staff_commission_seller on finance.staff_commission_entries (seller_id, created_at desc);

create or replace function finance.staff_commission_on_order() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r finance.staff_commission_rules%rowtype; v_bps int; v_base bigint;
begin
  if tg_op = 'INSERT' then
    select * into r from finance.staff_commission_rules where effective_from <= new.confirmed_at
     order by version desc limit 1;
    if not found then return new; end if; -- sem regra: nenhum valor presumido
    v_bps := coalesce((r.overrides->>new.owner_id::text)::int, r.default_bps);
    v_base := greatest(new.total_cents - new.freight_cents, 0);
    insert into finance.staff_commission_entries (order_id, seller_id, rule_id, base_cents, bps, amount_cents)
    values (new.id, new.owner_id, r.id, v_base, v_bps, (v_base * v_bps + 5000) / 10000);
  elsif new.commercial_state = 'CANCELLED' and old.commercial_state <> 'CANCELLED' then
    update finance.staff_commission_entries set state = 'REVERSED', reversed_at = now()
     where order_id = new.id and state = 'ACCRUED';
  end if;
  return new;
end $$;
create trigger staff_commission_order after insert or update of commercial_state on sales.orders
  for each row execute function finance.staff_commission_on_order();

create or replace function api.staff_commission_rule_get(p_actor uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_role text := identity.require_actor(p_actor); r finance.staff_commission_rules%rowtype;
begin
  select * into r from finance.staff_commission_rules order by version desc limit 1;
  if not found then return jsonb_build_object('configured', false); end if;
  return jsonb_build_object('configured', true, 'id', r.id, 'version', r.version, 'default_bps', r.default_bps,
    'overrides', case when v_role = 'OWNER' then r.overrides
                      else jsonb_strip_nulls(jsonb_build_object(p_actor::text, r.overrides->p_actor::text)) end,
    'my_bps', coalesce((r.overrides->>p_actor::text)::int, r.default_bps),
    'effective_from', r.effective_from, 'note', r.note);
end $$;

create or replace function api.staff_commission_rule_create(p_ctx jsonb, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (p_ctx->>'actor_id')::uuid; v_ver int; v_id uuid; k text;
begin
  perform identity.require_actor(v_actor, 'users.manage');
  if not coalesce((p_ctx->>'mfa_recent')::boolean, false) then perform api.fail('MFA_RECENCY_REQUIRED'); end if;
  for k in select jsonb_object_keys(coalesce(p->'overrides', '{}'::jsonb)) loop
    if not exists (select 1 from identity.profiles where id = k::uuid) then
      perform api.fail('VALIDATION_FAILED', jsonb_build_object('field', 'overrides', 'reason', 'unknown_profile'));
    end if;
  end loop;
  perform pg_advisory_xact_lock(hashtextextended('staff-commission-rule', 0));
  select coalesce(max(version), 0) + 1 into v_ver from finance.staff_commission_rules;
  if (p->>'expected_version')::int is distinct from v_ver - 1 then perform api.fail('VERSION_CONFLICT'); end if;
  insert into finance.staff_commission_rules (version, default_bps, overrides, note, created_by)
  values (v_ver, (p->>'default_bps')::int, coalesce(p->'overrides', '{}'::jsonb), nullif(btrim(p->>'note'), ''), v_actor)
  returning id into v_id;
  perform audit.record(p_ctx, 'staff_commission_rule.created', 'staff_commission_rule', v_id, p);
  return jsonb_build_object('id', v_id, 'version', v_ver);
end $$;

-- Extrato: OWNER vê todos (ou filtra por vendedor); SELLER só o próprio, qualquer filtro é ignorado.
create or replace function api.staff_commission_statement(p_actor uuid, p jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_role text := identity.require_actor(p_actor); v_seller uuid; v_from timestamptz; v_to timestamptz;
begin
  v_seller := case when v_role = 'OWNER' then nullif(p->>'seller_id', '')::uuid else p_actor end;
  v_from := coalesce((p->>'from')::timestamptz, '-infinity'); v_to := coalesce((p->>'to')::timestamptz, 'infinity');
  return jsonb_build_object(
    'rule_configured', exists (select 1 from finance.staff_commission_rules),
    'entries', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'order_id', o.id, 'order_number', o.display_number,
        'confirmed_at', o.confirmed_at, 'customer_name', o.customer_snapshot->>'name', 'seller_id', e.seller_id,
        'seller_name', pr.name, 'base_cents', e.base_cents::text, 'bps', e.bps, 'amount_cents', e.amount_cents::text,
        'state', e.state, 'paid_at', e.paid_at, 'paid_note', e.paid_note) order by o.confirmed_at desc)
      from finance.staff_commission_entries e join sales.orders o on o.id = e.order_id
      join identity.profiles pr on pr.id = e.seller_id
     where (v_seller is null or e.seller_id = v_seller) and o.confirmed_at >= v_from and o.confirmed_at < v_to), '[]'::jsonb),
    'by_seller', coalesce((select jsonb_agg(jsonb_build_object('seller_id', s.seller_id, 'seller_name', s.name,
        'orders', s.n, 'sales_cents', s.base::text, 'accrued_cents', s.accrued::text, 'paid_cents', s.paid::text,
        'reversed_cents', s.reversed::text) order by s.name)
      from (select e.seller_id, pr.name, count(*) filter (where e.state <> 'REVERSED') n,
                   coalesce(sum(e.base_cents) filter (where e.state <> 'REVERSED'), 0) base,
                   coalesce(sum(e.amount_cents) filter (where e.state = 'ACCRUED'), 0) accrued,
                   coalesce(sum(e.amount_cents) filter (where e.state = 'PAID'), 0) paid,
                   coalesce(sum(e.amount_cents) filter (where e.state = 'REVERSED'), 0) reversed
              from finance.staff_commission_entries e join sales.orders o on o.id = e.order_id
              join identity.profiles pr on pr.id = e.seller_id
             where (v_seller is null or e.seller_id = v_seller) and o.confirmed_at >= v_from and o.confirmed_at < v_to
             group by e.seller_id, pr.name) s), '[]'::jsonb));
end $$;

create or replace function api.staff_commission_mark_paid(p_ctx jsonb, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (p_ctx->>'actor_id')::uuid; v_n int;
begin
  perform identity.require_actor(v_actor, 'users.manage');
  if not coalesce((p_ctx->>'mfa_recent')::boolean, false) then perform api.fail('MFA_RECENCY_REQUIRED'); end if;
  update finance.staff_commission_entries set state = 'PAID', paid_at = now(), paid_by = v_actor,
         paid_note = nullif(btrim(p->>'note'), '')
   where id in (select (jsonb_array_elements_text(p->'entry_ids'))::uuid) and state = 'ACCRUED';
  get diagnostics v_n = row_count;
  if v_n <> jsonb_array_length(p->'entry_ids') then perform api.fail('VERSION_CONFLICT', jsonb_build_object('reason', 'entry_not_accrued')); end if;
  perform audit.record(p_ctx, 'staff_commission.paid', 'staff_commission', null, p);
  return jsonb_build_object('paid', v_n);
end $$;

-- ============================================================ grants
grant execute on all functions in schema api to ninebike_api;
revoke execute on function api.fail(text, jsonb) from ninebike_api;
revoke all on all functions in schema integrations, finance from public;
revoke all on all tables in schema integrations, finance from public;
alter table integrations.agent_clients enable row level security;
alter table integrations.agent_requests enable row level security;
alter table integrations.agent_lead_events enable row level security;
alter table finance.staff_commission_rules enable row level security;
alter table finance.staff_commission_entries enable row level security;
