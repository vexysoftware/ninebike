-- NINEBIKE OS — T04 propostas, reservas, pedidos (Registro de vendas) + T05 núcleo: obrigações e comissão 1,5% bruto.
-- Confirmar pedido NÃO cobra nem confirma recebimento: cobrança depende do PSP (T07, pendente).

create schema if not exists sales;
create schema if not exists finance;
revoke all on schema sales, finance from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on schema sales, finance from anon, authenticated';
  end if;
end $$;

-- ---------------------------------------------------------------- política comercial (prazos e alçadas)
create table identity.commercial_policies (
  id uuid primary key default gen_random_uuid(),
  revision integer not null unique check (revision > 0),
  reservation_minutes integer not null check (reservation_minutes > 0),
  quote_validity_minutes integer not null check (quote_validity_minutes > 0),
  seller_max_discount_bps integer not null default 0 check (seller_max_discount_bps between 0 and 10000),
  approved_by uuid not null references identity.profiles(id),
  effective_at timestamptz not null default now()
);

create or replace function identity.current_policy() returns identity.commercial_policies
language sql stable security definer set search_path = '' as $$
  select * from identity.commercial_policies order by revision desc limit 1
$$;

-- ---------------------------------------------------------------- regra da comissão do software
create table finance.commission_rules (
  id uuid primary key default gen_random_uuid(),
  revision integer not null unique,
  rate_bps smallint not null check (rate_bps = 150),
  base_policy jsonb not null,
  state text not null check (state in ('ACCEPTED')),
  effective_at timestamptz not null default now()
);
insert into finance.commission_rules (revision, rate_bps, base_policy, state)
values (1, 150, '{"base":"GROSS_COMMERCIAL_APPROVED","rounding":"floor((B*15+500)/1000)","decided_on":"2026-10-23"}', 'ACCEPTED');

-- Alvo inteiro da comissão; NUMERIC no intermediário evita overflow antes do BIGINT.
create or replace function finance.commission_target(p_base bigint) returns bigint language sql immutable as $$
  select floor((p_base::numeric * 15 + 500) / 1000)::bigint
$$;

-- ---------------------------------------------------------------- propostas
create sequence sales.order_number_seq;

create table sales.quotes (
  id uuid primary key default gen_random_uuid(),
  series_id uuid not null,
  revision integer not null check (revision > 0),
  contact_id uuid not null references crm.contacts(id),
  opportunity_id uuid references crm.opportunities(id),
  owner_id uuid not null references identity.profiles(id),
  policy_id uuid not null references identity.commercial_policies(id),
  valid_until timestamptz not null,
  state text not null check (state in ('DRAFT', 'ACCEPTED', 'SUPERSEDED', 'CANCELLED')),
  subtotal_cents bigint not null check (subtotal_cents >= 0),
  discount_cents bigint not null check (discount_cents >= 0),
  freight_cents bigint not null default 0 check (freight_cents >= 0),
  total_cents bigint not null check (total_cents >= 0),
  created_by uuid not null references identity.profiles(id),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  unique (series_id, revision)
);
create unique index quotes_one_accepted on sales.quotes (series_id) where state = 'ACCEPTED';
create unique index quotes_one_draft on sales.quotes (series_id) where state = 'DRAFT';
create index quotes_owner on sales.quotes (owner_id, created_at desc);

create table sales.quote_items (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references sales.quotes(id),
  position integer not null,
  product_id uuid not null references inventory.products(id),
  unit_id uuid references inventory.inventory_units(id),
  quantity integer not null check (quantity > 0),
  unit_price_cents bigint not null check (unit_price_cents >= 0),
  discount_cents bigint not null default 0 check (discount_cents >= 0),
  description_snapshot text not null,
  unique (quote_id, position),
  check (discount_cents <= unit_price_cents * quantity),
  check (unit_id is null or quantity = 1)
);

-- ---------------------------------------------------------------- reservas em grupo
create table inventory.reservation_groups (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references sales.quotes(id),
  quote_version integer not null,
  state text not null check (state in ('ACTIVE', 'COMMITTED', 'RELEASED', 'EXPIRED')),
  expires_at timestamptz not null,
  owner_id uuid not null references identity.profiles(id),
  order_id uuid,
  version integer not null default 1,
  created_at timestamptz not null default now()
);
create unique index reservation_groups_active_quote on inventory.reservation_groups (quote_id) where state in ('ACTIVE', 'COMMITTED');

create table inventory.stock_reservations (
  id uuid primary key default gen_random_uuid(),
  reservation_group_id uuid not null references inventory.reservation_groups(id),
  product_id uuid not null references inventory.products(id),
  unit_id uuid references inventory.inventory_units(id),
  quote_item_id uuid not null references sales.quote_items(id),
  order_item_id uuid,
  quantity integer not null check (quantity > 0),
  state text not null check (state in ('ACTIVE', 'COMMITTED', 'RELEASED', 'EXPIRED', 'CONSUMED')),
  check (unit_id is null or quantity = 1)
);
create unique index stock_reservations_unit_live on inventory.stock_reservations (unit_id) where unit_id is not null and state in ('ACTIVE', 'COMMITTED');
create index stock_reservations_group on inventory.stock_reservations (reservation_group_id);

-- ---------------------------------------------------------------- pedidos (Registro de vendas)
create table sales.orders (
  id uuid primary key default gen_random_uuid(),
  display_number bigint not null unique default nextval('sales.order_number_seq'),
  confirmed_at timestamptz not null default now(),
  created_by uuid not null references identity.profiles(id),
  owner_id uuid not null references identity.profiles(id),
  seller_snapshot jsonb not null,
  quote_id uuid not null unique references sales.quotes(id),
  quote_series_id uuid not null unique,
  contact_id uuid not null references crm.contacts(id),
  customer_snapshot jsonb not null,
  commercial_state text not null check (commercial_state in ('CONFIRMED', 'CANCELLED', 'CLOSED')),
  coverage_state text not null default 'NONE' check (coverage_state in ('NONE', 'PARTIAL', 'FULL_CONFIRMED', 'PARTIAL_REVERSAL', 'REVERSED', 'DISPUTED')),
  delivery_state text not null default 'PENDING' check (delivery_state in ('PENDING', 'DELIVERED')),
  fiscal_state text not null default 'NOT_PREPARED' check (fiscal_state in ('NOT_PREPARED', 'DRAFT', 'IN_REVIEW', 'APPROVED_INTERNALLY', 'AUTHORIZED_EXTERNAL')),
  total_cents bigint not null check (total_cents >= 0),
  freight_cents bigint not null default 0,
  commission_base_cents bigint not null check (commission_base_cents >= 0),
  commission_target_cents bigint not null check (commission_target_cents >= 0),
  commission_rule_id uuid not null references finance.commission_rules(id),
  rule_snapshot jsonb not null,
  cancelled_reason text,
  version integer not null default 1,
  updated_at timestamptz not null default now()
);
create index orders_confirmed on sales.orders (confirmed_at desc, id desc);
create index orders_owner on sales.orders (owner_id, confirmed_at desc, id desc);
create index orders_contact on sales.orders (contact_id, confirmed_at desc);
alter table inventory.reservation_groups add constraint reservation_groups_order foreign key (order_id) references sales.orders(id);

create table sales.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references sales.orders(id),
  position integer not null,
  product_id uuid not null references inventory.products(id),
  unit_id uuid references inventory.inventory_units(id),
  quantity integer not null check (quantity > 0),
  description_snapshot text not null,
  unit_price_cents bigint not null,
  discount_cents bigint not null,
  cost_snapshot_cents bigint check (cost_snapshot_cents >= 0),
  unique (order_id, position)
);
create index order_items_product on sales.order_items (product_id, order_id);
create index order_items_unit on sales.order_items (unit_id);
alter table inventory.stock_reservations add constraint stock_reservations_order_item foreign key (order_item_id) references sales.order_items(id);

create table finance.payment_allocations (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references sales.orders(id),
  plan_revision integer not null default 1,
  position integer not null,
  principal_cents bigint not null check (principal_cents > 0),
  commission_base_cents bigint not null check (commission_base_cents >= 0),
  due_date date not null,
  approved_method text not null check (approved_method in ('PIX', 'BOLETO', 'CARD', 'KOIN_APP_PIX')),
  requested_installment_count smallint,
  state text not null default 'ACTIVE' check (state in ('ACTIVE', 'SUPERSEDED', 'CANCELLED')),
  unique (order_id, plan_revision, position),
  check ((approved_method = 'CARD' and requested_installment_count between 1 and 24)
      or (approved_method <> 'CARD' and requested_installment_count is null))
);

create table finance.commission_allocations (
  payment_allocation_id uuid primary key references finance.payment_allocations(id),
  original_commission_cents bigint not null check (original_commission_cents >= 0),
  rule_id uuid not null references finance.commission_rules(id)
);

-- ---------------------------------------------------------------- helpers
create or replace function sales.can_see_quote(p_actor uuid, p_role text, q sales.quotes) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_role = 'OWNER' or q.owner_id = p_actor
      or (q.opportunity_id is not null and crm.can_see_opportunity(p_actor, p_role, q.opportunity_id))
$$;

-- Expira reservas ACTIVE vencidas (estado persistido), devolvendo unidades/saldos. Chamado dentro das RPCs.
create or replace function inventory.expire_reservations(p_product uuid default null) returns void
language plpgsql security definer set search_path = '' as $$
declare g record; r record;
begin
  for g in select * from inventory.reservation_groups where state = 'ACTIVE' and expires_at <= now()
             and (p_product is null or exists (select 1 from inventory.stock_reservations s where s.reservation_group_id = id and s.product_id = p_product))
           order by id for update skip locked loop
    for r in select * from inventory.stock_reservations where reservation_group_id = g.id and state = 'ACTIVE' loop
      if r.unit_id is not null then
        update inventory.inventory_units set state = 'IN_STOCK', version = version + 1, updated_at = now() where id = r.unit_id and state = 'RESERVED';
      else
        update inventory.quantity_balances set reserved = reserved - r.quantity where product_id = r.product_id;
      end if;
      update inventory.stock_reservations set state = 'EXPIRED' where id = r.id;
    end loop;
    update inventory.reservation_groups set state = 'EXPIRED', version = version + 1 where id = g.id;
  end loop;
end $$;

create or replace function sales.quote_json(q sales.quotes, p_role text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', q.id, 'series_id', q.series_id, 'revision', q.revision, 'state', q.state,
    'contact_id', q.contact_id, 'contact_name', (select name from crm.contacts where id = q.contact_id),
    'opportunity_id', q.opportunity_id, 'owner_id', q.owner_id, 'owner_name', (select name from identity.profiles where id = q.owner_id),
    'valid_until', q.valid_until, 'expired', q.valid_until <= now(),
    'subtotal_cents', q.subtotal_cents::text, 'discount_cents', q.discount_cents::text,
    'freight_cents', q.freight_cents::text, 'total_cents', q.total_cents::text, 'version', q.version, 'created_at', q.created_at,
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'position', i.position, 'product_id', i.product_id,
        'unit_id', i.unit_id, 'unit_code', (select internal_code from inventory.inventory_units where id = i.unit_id),
        'quantity', i.quantity, 'unit_price_cents', i.unit_price_cents::text, 'discount_cents', i.discount_cents::text,
        'description', i.description_snapshot,
        'line_total_cents', (i.unit_price_cents * i.quantity - i.discount_cents)::text) order by i.position)
      from sales.quote_items i where i.quote_id = q.id), '[]'::jsonb),
    'reservation', (select jsonb_build_object('id', g.id, 'state', g.state, 'expires_at', g.expires_at,
        'units', (select jsonb_agg(u.internal_code) from inventory.stock_reservations s join inventory.inventory_units u on u.id = s.unit_id
                   where s.reservation_group_id = g.id))
      from inventory.reservation_groups g where g.quote_id = q.id order by g.created_at desc limit 1),
    'order_id', (select id from sales.orders where quote_id = q.id))
$$;

-- ---------------------------------------------------------------- política (OWNER)
create or replace function api.policy_get(p_actor uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare p identity.commercial_policies;
begin
  perform identity.require_actor(p_actor, 'crm.read');
  p := identity.current_policy();
  if p.id is null then return null; end if;
  return jsonb_build_object('revision', p.revision, 'reservation_minutes', p.reservation_minutes,
    'quote_validity_minutes', p.quote_validity_minutes, 'seller_max_discount_bps', p.seller_max_discount_bps, 'effective_at', p.effective_at);
end $$;

create or replace function api.policy_create(p_ctx jsonb, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (p_ctx->>'actor_id')::uuid; v_rev int;
begin
  perform identity.require_actor(v_actor, 'pipeline.manage');
  perform pg_advisory_xact_lock(hashtextextended('identity.policy', 0));
  select coalesce(max(revision), 0) + 1 into v_rev from identity.commercial_policies;
  if v_rev - 1 <> (p->>'expected_revision')::int then perform api.fail('VERSION_CONFLICT'); end if;
  insert into identity.commercial_policies (revision, reservation_minutes, quote_validity_minutes, seller_max_discount_bps, approved_by)
  values (v_rev, (p->>'reservation_minutes')::int, (p->>'quote_validity_minutes')::int, (p->>'seller_max_discount_bps')::int, v_actor);
  perform audit.record(p_ctx, 'policy.created', 'commercial_policy', null, p);
  return jsonb_build_object('revision', v_rev);
end $$;

-- ---------------------------------------------------------------- proposta: valores sempre do servidor
create or replace function sales.write_quote(p_ctx jsonb, p jsonb, p_series uuid, p_revision int, p_owner uuid, p_role text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (p_ctx->>'actor_id')::uuid; v_pol identity.commercial_policies; v_id uuid := gen_random_uuid();
        it jsonb; pr inventory.products; v_pos int := 0; v_sub bigint := 0; v_disc bigint := 0; v_price bigint; v_d bigint;
        v_freight bigint := coalesce((p->>'freight_cents')::bigint, 0); v_unit inventory.inventory_units;
begin
  v_pol := identity.current_policy();
  if v_pol.id is null then perform api.fail('CAPABILITY_UNAVAILABLE', jsonb_build_object('reason', 'commercial_policy_not_configured')); end if;
  insert into sales.quotes (id, series_id, revision, contact_id, opportunity_id, owner_id, policy_id, valid_until, state,
                            subtotal_cents, discount_cents, freight_cents, total_cents, created_by)
  values (v_id, p_series, p_revision, (p->>'contact_id')::uuid, (p->>'opportunity_id')::uuid, p_owner, v_pol.id,
          now() + make_interval(mins => v_pol.quote_validity_minutes), 'DRAFT', 0, 0, v_freight, 0, v_actor);
  for it in select * from jsonb_array_elements(p->'items') loop
    select * into pr from inventory.products where id = (it->>'product_id')::uuid;
    if not found or not pr.active then perform api.fail('VALIDATION_FAILED', jsonb_build_object('field', 'items', 'reason', 'product_unavailable', 'index', v_pos)); end if;
    if pr.sale_price_cents is null then perform api.fail('VALIDATION_FAILED', jsonb_build_object('field', 'items', 'reason', 'product_without_price', 'index', v_pos)); end if;
    if it->>'unit_id' is not null then
      select * into v_unit from inventory.inventory_units where id = (it->>'unit_id')::uuid;
      if not found or v_unit.product_id <> pr.id or (it->>'quantity')::int <> 1 then
        perform api.fail('VALIDATION_FAILED', jsonb_build_object('field', 'items', 'reason', 'unit_mismatch', 'index', v_pos));
      end if;
    end if;
    v_price := pr.sale_price_cents;
    v_d := coalesce((it->>'discount_cents')::bigint, 0);
    if v_d > v_price * (it->>'quantity')::int then perform api.fail('VALIDATION_FAILED', jsonb_build_object('field', 'items', 'reason', 'discount_above_price', 'index', v_pos)); end if;
    insert into sales.quote_items (quote_id, position, product_id, unit_id, quantity, unit_price_cents, discount_cents, description_snapshot)
    values (v_id, v_pos, pr.id, (it->>'unit_id')::uuid, (it->>'quantity')::int, v_price, v_d, pr.name);
    v_sub := v_sub + v_price * (it->>'quantity')::int; v_disc := v_disc + v_d; v_pos := v_pos + 1;
  end loop;
  -- Alçada: SELLER até o limite da política; ausência de limite (0) nega desconto. OWNER aprova a própria exceção.
  if p_role <> 'OWNER' and v_disc > 0 and v_disc * 10000 > v_sub * v_pol.seller_max_discount_bps then
    perform api.fail('APPROVAL_REQUIRED', jsonb_build_object('reason', 'discount_above_seller_limit', 'limit_bps', v_pol.seller_max_discount_bps));
  end if;
  update sales.quotes set subtotal_cents = v_sub, discount_cents = v_disc, total_cents = v_sub - v_disc + v_freight where id = v_id;
  return v_id;
end $$;

create or replace function api.quote_create(p_ctx jsonb, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (p_ctx->>'actor_id')::uuid; v_role text := identity.require_actor(v_actor, 'crm.write');
        v_id uuid; v_owner uuid;
begin
  if not crm.can_see_contact(v_actor, v_role, (p->>'contact_id')::uuid) then perform api.fail('NOT_FOUND', jsonb_build_object('resource', 'contact')); end if;
  if p->>'opportunity_id' is not null then
    if not crm.can_see_opportunity(v_actor, v_role, (p->>'opportunity_id')::uuid)
       or not exists (select 1 from crm.opportunities where id = (p->>'opportunity_id')::uuid and contact_id = (p->>'contact_id')::uuid) then
      perform api.fail('NOT_FOUND', jsonb_build_object('resource', 'opportunity'));
    end if;
    select owner_id into v_owner from crm.opportunities where id = (p->>'opportunity_id')::uuid;
  end if;
  v_id := sales.write_quote(p_ctx, p, gen_random_uuid(), 1, coalesce(v_owner, v_actor), v_role);
  perform audit.record(p_ctx, 'quote.created', 'quote', v_id, '{}'::jsonb);
  return jsonb_build_object('id', v_id, 'version', 1);
end $$;

-- Revisão: nova linha na mesma série; a anterior vira SUPERSEDED (nunca sobrescrita) e solta reserva ativa.
create or replace function api.quote_revise(p_ctx jsonb, p_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (p_ctx->>'actor_id')::uuid; v_role text := identity.require_actor(v_actor, 'crm.write');
        q sales.quotes; v_id uuid;
begin
  select * into q from sales.quotes where id = p_id for update;
  if not found or not sales.can_see_quote(v_actor, v_role, q) then perform api.fail('NOT_FOUND'); end if;
  if q.state <> 'DRAFT' then perform api.fail('VERSION_CONFLICT', jsonb_build_object('reason', 'quote_not_draft')); end if;
  if q.version <> (p->>'expected_version')::int then perform api.fail('VERSION_CONFLICT'); end if;
  if (p->>'contact_id')::uuid <> q.contact_id then perform api.fail('VALIDATION_FAILED', jsonb_build_object('field', 'contact_id', 'reason', 'immutable')); end if;
  perform sales.release_group(q.id, 'RELEASED');
  update sales.quotes set state = 'SUPERSEDED', version = version + 1 where id = p_id;
  v_id := sales.write_quote(p_ctx, p || jsonb_build_object('opportunity_id', q.opportunity_id), q.series_id, q.revision + 1, q.owner_id, v_role);
  perform audit.record(p_ctx, 'quote.revised', 'quote', v_id, jsonb_build_object('previous', p_id));
  return jsonb_build_object('id', v_id, 'version', 1);
end $$;

create or replace function sales.release_group(p_quote uuid, p_state text) returns void
language plpgsql security definer set search_path = '' as $$
declare g inventory.reservation_groups; r record;
begin
  select * into g from inventory.reservation_groups where quote_id = p_quote and state = 'ACTIVE' for update;
  if not found then return; end if;
  for r in select * from inventory.stock_reservations where reservation_group_id = g.id and state = 'ACTIVE' loop
    if r.unit_id is not null then
      update inventory.inventory_units set state = 'IN_STOCK', version = version + 1, updated_at = now() where id = r.unit_id and state = 'RESERVED';
    else
      update inventory.quantity_balances set reserved = reserved - r.quantity where product_id = r.product_id;
    end if;
    update inventory.stock_reservations set state = p_state where id = r.id;
  end loop;
  update inventory.reservation_groups set state = p_state, version = version + 1 where id = g.id;
end $$;

create or replace function api.quote_get(p_actor uuid, p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_role text := identity.require_actor(p_actor, 'crm.read'); q sales.quotes;
begin
  select * into q from sales.quotes where id = p_id;
  if not found or not sales.can_see_quote(p_actor, v_role, q) then perform api.fail('NOT_FOUND'); end if;
  return sales.quote_json(q, v_role) || jsonb_build_object('revisions', (select jsonb_agg(jsonb_build_object('id', id, 'revision', revision, 'state', state, 'total_cents', total_cents::text) order by revision)
     from sales.quotes where series_id = q.series_id));
end $$;

create or replace function api.quote_list(p_actor uuid, p jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_role text := identity.require_actor(p_actor, 'crm.read');
begin
  return coalesce((select jsonb_agg(sales.quote_json(q, v_role) order by q.created_at desc) from (
    select * from sales.quotes q where q.state in ('DRAFT', 'ACCEPTED') and sales.can_see_quote(p_actor, v_role, q)
      and (p->>'opportunity_id' is null or q.opportunity_id = (p->>'opportunity_id')::uuid)
      and (p->>'contact_id' is null or q.contact_id = (p->>'contact_id')::uuid)
    order by q.created_at desc limit 100) q), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------- reserva em grupo: tudo ou nada, sob lock
create or replace function api.reservation_create(p_ctx jsonb, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (p_ctx->>'actor_id')::uuid; v_role text := identity.require_actor(v_actor, 'crm.write');
        q sales.quotes; v_pol identity.commercial_policies; v_group uuid; it sales.quote_items; pr inventory.products;
        v_unit uuid; v_avail int;
begin
  select * into q from sales.quotes where id = (p->>'quote_id')::uuid for update;
  if not found or not sales.can_see_quote(v_actor, v_role, q) then perform api.fail('NOT_FOUND'); end if;
  if q.version <> (p->>'quote_version')::int or q.state <> 'DRAFT' then perform api.fail('VERSION_CONFLICT'); end if;
  if q.valid_until <= now() then perform api.fail('VALIDATION_FAILED', jsonb_build_object('reason', 'quote_expired')); end if;
  perform inventory.expire_reservations(null);
  if exists (select 1 from inventory.reservation_groups where quote_id = q.id and state in ('ACTIVE', 'COMMITTED')) then
    perform api.fail('OPERATION_IN_PROGRESS', jsonb_build_object('reason', 'already_reserved'));
  end if;
  v_pol := identity.current_policy();
  insert into inventory.reservation_groups (quote_id, quote_version, state, expires_at, owner_id)
  values (q.id, q.version, 'ACTIVE', now() + make_interval(mins => v_pol.reservation_minutes), q.owner_id) returning id into v_group;
  -- Trava produtos em ordem estável para evitar deadlock entre reservas concorrentes.
  perform 1 from inventory.products where id in (select product_id from sales.quote_items where quote_id = q.id) order by id for update;
  for it in select * from sales.quote_items where quote_id = q.id order by position loop
    select * into pr from inventory.products where id = it.product_id;
    if pr.inventory_opening_state <> 'CONFIRMED' then perform api.fail('RESERVATION_CONFLICT', jsonb_build_object('reason', 'opening_not_confirmed', 'product', pr.name)); end if;
    if pr.tracking = 'UNIT' then
      for i in 1..it.quantity loop
        if it.unit_id is not null then
          select id into v_unit from inventory.inventory_units where id = it.unit_id and state = 'IN_STOCK' for update;
        else
          -- Escolha determinística e visível (menor código interno disponível), retornada ao usuário.
          select id into v_unit from inventory.inventory_units where product_id = pr.id and state = 'IN_STOCK'
           order by internal_code limit 1 for update skip locked;
        end if;
        if v_unit is null then perform api.fail('RESERVATION_CONFLICT', jsonb_build_object('reason', 'no_unit_available', 'product', pr.name)); end if;
        update inventory.inventory_units set state = 'RESERVED', version = version + 1, updated_at = now() where id = v_unit;
        insert into inventory.stock_reservations (reservation_group_id, product_id, unit_id, quote_item_id, quantity, state)
        values (v_group, pr.id, v_unit, it.id, 1, 'ACTIVE');
        v_unit := null;
      end loop;
    else
      select on_hand - reserved - committed - inspection - maintenance into v_avail from inventory.quantity_balances where product_id = pr.id;
      if coalesce(v_avail, 0) < it.quantity then perform api.fail('RESERVATION_CONFLICT', jsonb_build_object('reason', 'insufficient_quantity', 'product', pr.name)); end if;
      update inventory.quantity_balances set reserved = reserved + it.quantity where product_id = pr.id;
      insert into inventory.stock_reservations (reservation_group_id, product_id, quote_item_id, quantity, state)
      values (v_group, pr.id, it.id, it.quantity, 'ACTIVE');
    end if;
  end loop;
  perform audit.record(p_ctx, 'reservation.created', 'quote', q.id, jsonb_build_object('group', v_group));
  return jsonb_build_object('id', v_group, 'expires_at', now() + make_interval(mins => v_pol.reservation_minutes));
end $$;

create or replace function api.reservation_release(p_ctx jsonb, p_quote uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (p_ctx->>'actor_id')::uuid; v_role text := identity.require_actor(v_actor, 'crm.write'); q sales.quotes;
begin
  select * into q from sales.quotes where id = p_quote for update;
  if not found or not sales.can_see_quote(v_actor, v_role, q) then perform api.fail('NOT_FOUND'); end if;
  perform sales.release_group(q.id, 'RELEASED');
  perform audit.record(p_ctx, 'reservation.released', 'quote', q.id, '{}'::jsonb);
  return jsonb_build_object('quote_id', q.id);
end $$;

-- ---------------------------------------------------------------- confirmação atômica: pedido + itens + compromisso + obrigações + comissão
create or replace function api.order_confirm(p_ctx jsonb, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (p_ctx->>'actor_id')::uuid; v_role text := identity.require_actor(v_actor, 'crm.write');
        q sales.quotes; g inventory.reservation_groups; v_rule finance.commission_rules; v_order uuid; v_number bigint;
        r record; v_oi uuid; a jsonb; v_pos int := 0; v_sum bigint := 0; v_acc bigint := 0; v_prev bigint := 0; v_t bigint;
        v_alloc uuid; v_base bigint; v_c crm.contacts;
begin
  select * into q from sales.quotes where id = (p->>'quote_id')::uuid for update;
  if not found or not sales.can_see_quote(v_actor, v_role, q) then perform api.fail('NOT_FOUND'); end if;
  if q.version <> (p->>'quote_version')::int then perform api.fail('VERSION_CONFLICT'); end if;
  if exists (select 1 from sales.orders where quote_series_id = q.series_id) then
    perform api.fail('OPERATION_IN_PROGRESS', jsonb_build_object('reason', 'order_already_exists', 'order_id', (select id from sales.orders where quote_series_id = q.series_id)));
  end if;
  if q.state <> 'DRAFT' then perform api.fail('VERSION_CONFLICT', jsonb_build_object('reason', 'quote_not_draft')); end if;
  if q.valid_until <= now() then perform api.fail('VALIDATION_FAILED', jsonb_build_object('reason', 'quote_expired')); end if;
  if q.total_cents <= 0 then perform api.fail('VALIDATION_FAILED', jsonb_build_object('reason', 'zero_total')); end if;
  select * into g from inventory.reservation_groups where quote_id = q.id and state = 'ACTIVE' for update;
  if not found or g.expires_at <= now() then perform api.fail('RESERVATION_CONFLICT', jsonb_build_object('reason', 'reservation_missing_or_expired')); end if;
  select * into v_rule from finance.commission_rules where state = 'ACCEPTED' order by revision desc limit 1;
  -- Condições de pagamento: soma exata do total, posições persistidas.
  for a in select * from jsonb_array_elements(p->'allocations') loop v_sum := v_sum + (a->>'principal_cents')::bigint; end loop;
  if v_sum <> q.total_cents then
    perform api.fail('VALIDATION_FAILED', jsonb_build_object('field', 'allocations', 'reason', 'sum_must_equal_total', 'total_cents', q.total_cents::text));
  end if;
  select * into v_c from crm.contacts where id = q.contact_id;
  insert into sales.orders (created_by, owner_id, seller_snapshot, quote_id, quote_series_id, contact_id, customer_snapshot, commercial_state,
                            total_cents, freight_cents, commission_base_cents, commission_target_cents, commission_rule_id, rule_snapshot)
  values (v_actor, q.owner_id, (select jsonb_build_object('id', id, 'name', name) from identity.profiles where id = q.owner_id),
          q.id, q.series_id, q.contact_id,
          jsonb_build_object('name', v_c.name, 'mobile', v_c.mobile_e164, 'cpf', v_c.cpf, 'cnpj', v_c.cnpj, 'email', v_c.email),
          'CONFIRMED', q.total_cents, q.freight_cents, q.total_cents, finance.commission_target(q.total_cents), v_rule.id,
          jsonb_build_object('revision', v_rule.revision, 'rate_bps', v_rule.rate_bps, 'base_policy', v_rule.base_policy))
  returning id, display_number into v_order, v_number;
  -- Itens com snapshot de preço e custo histórico (custo desconhecido fica null, nunca zero).
  for r in select s.*, i.position, i.unit_price_cents, i.discount_cents, i.description_snapshot,
                  (select acquisition_cost_cents from inventory.inventory_units where id = s.unit_id) as unit_cost
             from inventory.stock_reservations s join sales.quote_items i on i.id = s.quote_item_id
            where s.reservation_group_id = g.id and s.state = 'ACTIVE' order by i.position, s.id loop
    insert into sales.order_items (order_id, position, product_id, unit_id, quantity, description_snapshot, unit_price_cents, discount_cents, cost_snapshot_cents)
    values (v_order, v_pos, r.product_id, r.unit_id, r.quantity, r.description_snapshot,
            r.unit_price_cents, case when r.unit_id is null then r.discount_cents else
              -- desconto do item distribuído por unidade: fatias cumulativas para fechar o total
              (r.discount_cents * (select count(*) from inventory.stock_reservations x where x.quote_item_id = r.quote_item_id and x.id <= r.id)
                / (select count(*) from inventory.stock_reservations x where x.quote_item_id = r.quote_item_id))
              - (r.discount_cents * (select count(*) from inventory.stock_reservations x where x.quote_item_id = r.quote_item_id and x.id < r.id)
                / (select count(*) from inventory.stock_reservations x where x.quote_item_id = r.quote_item_id)) end,
            r.unit_cost)
    returning id into v_oi;
    v_pos := v_pos + 1;
    if r.unit_id is not null then
      update inventory.inventory_units set state = 'COMMITTED', version = version + 1, updated_at = now() where id = r.unit_id and state = 'RESERVED';
      if not found then perform api.fail('RESERVATION_CONFLICT', jsonb_build_object('reason', 'unit_state_changed')); end if;
    else
      update inventory.quantity_balances set reserved = reserved - r.quantity, committed = committed + r.quantity where product_id = r.product_id;
    end if;
    update inventory.stock_reservations set state = 'COMMITTED', order_item_id = v_oi where id = r.id;
  end loop;
  update inventory.reservation_groups set state = 'COMMITTED', order_id = v_order, version = version + 1 where id = g.id;
  -- Obrigações e comissão por diferença de alvos cumulativos (soma fecha o alvo do pedido).
  v_pos := 0;
  for a in select * from jsonb_array_elements(p->'allocations') loop
    v_base := (a->>'principal_cents')::bigint;
    insert into finance.payment_allocations (order_id, position, principal_cents, commission_base_cents, due_date, approved_method, requested_installment_count)
    values (v_order, v_pos, v_base, v_base, (a->>'due_date')::date, a->>'mode',
            case when a->>'mode' = 'CARD' then coalesce((a->>'installment_count')::smallint, 1) end)
    returning id into v_alloc;
    v_acc := v_acc + v_base; v_t := finance.commission_target(v_acc);
    insert into finance.commission_allocations (payment_allocation_id, original_commission_cents, rule_id) values (v_alloc, v_t - v_prev, v_rule.id);
    v_prev := v_t; v_pos := v_pos + 1;
  end loop;
  update sales.quotes set state = 'ACCEPTED', version = version + 1 where id = q.id;
  perform audit.record(p_ctx, 'order.confirmed', 'order', v_order, jsonb_build_object('number', v_number, 'total_cents', q.total_cents::text));
  return jsonb_build_object('id', v_order, 'display_number', v_number);
end $$;

-- ---------------------------------------------------------------- cancelamento antes de qualquer recebimento (OWNER)
create or replace function api.order_cancel(p_ctx jsonb, p_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (p_ctx->>'actor_id')::uuid; o sales.orders; r record;
begin
  perform identity.require_actor(v_actor, 'crm.manage');
  select * into o from sales.orders where id = p_id for update;
  if not found then perform api.fail('NOT_FOUND'); end if;
  if o.version <> (p->>'expected_version')::int then perform api.fail('VERSION_CONFLICT'); end if;
  if o.commercial_state <> 'CONFIRMED' or o.delivery_state <> 'PENDING' then perform api.fail('VALIDATION_FAILED', jsonb_build_object('reason', 'not_cancellable')); end if;
  if o.coverage_state <> 'NONE' then perform api.fail('VALIDATION_FAILED', jsonb_build_object('reason', 'has_payments_use_refund_flow')); end if;
  for r in select s.* from inventory.stock_reservations s join sales.order_items i on i.id = s.order_item_id where i.order_id = p_id and s.state = 'COMMITTED' loop
    if r.unit_id is not null then
      update inventory.inventory_units set state = 'IN_STOCK', version = version + 1, updated_at = now() where id = r.unit_id and state = 'COMMITTED';
    else
      update inventory.quantity_balances set committed = committed - r.quantity where product_id = r.product_id;
    end if;
    update inventory.stock_reservations set state = 'RELEASED' where id = r.id;
  end loop;
  update finance.payment_allocations set state = 'CANCELLED' where order_id = p_id;
  update sales.orders set commercial_state = 'CANCELLED', cancelled_reason = btrim(p->>'reason'), version = version + 1, updated_at = now() where id = p_id;
  perform audit.record(p_ctx, 'order.cancelled', 'order', p_id, jsonb_build_object('reason', p->>'reason'));
  return jsonb_build_object('id', p_id, 'version', o.version + 1);
end $$;

-- ---------------------------------------------------------------- Registro de vendas
create or replace function sales.order_json(o sales.orders, p_role text, p_detail boolean) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', o.id, 'display_number', o.display_number, 'confirmed_at', o.confirmed_at,
    'seller', o.seller_snapshot, 'contact_id', o.contact_id, 'customer', o.customer_snapshot - 'cpf' - 'cnpj',
    'commercial_state', o.commercial_state, 'coverage_state', o.coverage_state, 'delivery_state', o.delivery_state,
    'fiscal_state', o.fiscal_state, 'total_cents', o.total_cents::text, 'quote_id', o.quote_id,
    'item_count', (select sum(quantity) from sales.order_items where order_id = o.id), 'version', o.version,
    'cancelled_reason', o.cancelled_reason)
  || case when not p_detail then '{}'::jsonb else jsonb_build_object(
    'items', (select jsonb_agg(jsonb_build_object('position', i.position, 'product_id', i.product_id, 'description', i.description_snapshot,
        'unit_code', u.internal_code, 'serial_number', u.serial_normalized, 'quantity', i.quantity,
        'unit_price_cents', i.unit_price_cents::text, 'discount_cents', i.discount_cents::text,
        'line_total_cents', (i.unit_price_cents * i.quantity - i.discount_cents)::text)
        || case when p_role = 'OWNER' then jsonb_build_object('cost_snapshot_cents', i.cost_snapshot_cents::text) else '{}'::jsonb end
        order by i.position) from sales.order_items i left join inventory.inventory_units u on u.id = i.unit_id where i.order_id = o.id),
    'allocations', (select jsonb_agg(jsonb_build_object('id', a.id, 'position', a.position, 'mode', a.approved_method,
        'installment_count', a.requested_installment_count, 'principal_cents', a.principal_cents::text, 'due_date', a.due_date, 'state', a.state)
        order by a.position) from finance.payment_allocations a where a.order_id = o.id))
  || case when p_role = 'OWNER' then jsonb_build_object('customer_document', coalesce(o.customer_snapshot->>'cpf', o.customer_snapshot->>'cnpj'),
       'commission_target_cents', o.commission_target_cents::text) else '{}'::jsonb end
  end
$$;

create or replace function api.order_list(p_actor uuid, p jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_role text := identity.require_actor(p_actor, 'crm.read');
        v_limit int := least(greatest(coalesce((p->>'limit')::int, 50), 1), 100); v_rows jsonb; v_more boolean;
begin
  with page as (
    select * from sales.orders o
     where (v_role = 'OWNER' or o.owner_id = p_actor)
       and (p->>'owner_id' is null or o.owner_id = (p->>'owner_id')::uuid)
       and (p->>'contact_id' is null or o.contact_id = (p->>'contact_id')::uuid)
       and (p->>'state' is null or o.commercial_state = p->>'state')
       and (p->>'from' is null or o.confirmed_at >= (p->>'from')::timestamptz)
       and (p->>'to' is null or o.confirmed_at < (p->>'to')::timestamptz)
       and (p->>'cursor_at' is null or (o.confirmed_at, o.id) < ((p->>'cursor_at')::timestamptz, (p->>'cursor_id')::uuid))
     order by o.confirmed_at desc, o.id desc limit v_limit + 1)
  select coalesce(jsonb_agg(sales.order_json(page, v_role, false) order by page.confirmed_at desc, page.id desc), '[]'::jsonb), count(*) > v_limit
    into v_rows, v_more from page;
  if v_more then v_rows := v_rows - (jsonb_array_length(v_rows) - 1); end if;
  return jsonb_build_object('data', v_rows, 'has_more', v_more,
    'totals', (select jsonb_build_object('count', count(*), 'total_cents', coalesce(sum(total_cents), 0)::text) from sales.orders o
      where (v_role = 'OWNER' or o.owner_id = p_actor) and o.commercial_state <> 'CANCELLED'
        and (p->>'owner_id' is null or o.owner_id = (p->>'owner_id')::uuid)
        and (p->>'from' is null or o.confirmed_at >= (p->>'from')::timestamptz)
        and (p->>'to' is null or o.confirmed_at < (p->>'to')::timestamptz)));
end $$;

create or replace function api.order_get(p_actor uuid, p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_role text := identity.require_actor(p_actor, 'crm.read'); o sales.orders;
begin
  select * into o from sales.orders where id = p_id;
  if not found or (v_role <> 'OWNER' and o.owner_id <> p_actor) then perform api.fail('NOT_FOUND'); end if;
  return sales.order_json(o, v_role, true);
end $$;

grant execute on all functions in schema api to ninebike_api;
revoke execute on function api.fail(text, jsonb) from ninebike_api;
do $$
declare r record; s text;
begin
  foreach s in array array['sales','finance'] loop
    execute format('revoke all on all functions in schema %I from public', s);
    execute format('revoke all on all tables in schema %I from public', s);
  end loop;
  revoke all on table identity.commercial_policies, inventory.reservation_groups, inventory.stock_reservations from public;
  for r in select schemaname, tablename from pg_tables where schemaname in ('sales','finance','identity','inventory') loop
    execute format('alter table %I.%I enable row level security', r.schemaname, r.tablename);
  end loop;
end $$;
revoke execute on all functions in schema api from public;
