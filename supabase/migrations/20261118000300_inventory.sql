-- NINEBIKE OS — T03 catálogo, fotos e estoque. Saldos derivados de movimentos auditados; nada de PATCH de saldo.

create schema if not exists inventory;
revoke all on schema inventory from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on schema inventory from anon, authenticated';
  end if;
end $$;

create sequence inventory.sku_seq;
create sequence inventory.unit_code_seq;

create table inventory.products (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> '' and length(name) <= 200),
  sku text not null unique check (btrim(sku) <> '' and length(sku) <= 60),
  tracking text check (tracking in ('UNIT', 'QUANTITY')),
  active boolean not null default true,
  migration_pending boolean not null default false,
  inventory_opening_state text not null default 'UNKNOWN' check (inventory_opening_state in ('UNKNOWN', 'CONFIRMED')),
  primary_photo_id uuid,
  sale_price_cents bigint check (sale_price_cents >= 0),
  reference_cost_cents bigint check (reference_cost_cents >= 0),
  brand text, category text, size text, color text, measurement_unit text, warranty_note text,
  preferred_supplier_contact_id uuid references crm.contacts(id),
  minimum_stock integer check (minimum_stock >= 0),
  location text,
  variant_description text,
  archived_reason text,
  inventory_version integer not null default 1 check (inventory_version > 0),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (tracking is not null or (migration_pending and not active))
);
create index products_name on inventory.products (active, name);

alter table crm.opportunities add constraint opportunities_interest_product
  foreign key (interest_product_id) references inventory.products(id);

create table inventory.inventory_units (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references inventory.products(id),
  internal_code text not null unique,
  serial_normalized text check (serial_normalized ~ '^[A-Z0-9./-]{3,60}$'),
  chassis_normalized text check (chassis_normalized ~ '^[A-Z0-9./-]{3,60}$'),
  state text not null check (state in ('IN_STOCK', 'RESERVED', 'COMMITTED', 'INSPECTION', 'MAINTENANCE',
                                       'DELIVERED', 'WRITTEN_OFF')),
  acquisition_cost_cents bigint check (acquisition_cost_cents >= 0),
  supplier_contact_id uuid references crm.contacts(id),
  receipt_movement_id uuid,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index inventory_units_serial on inventory.inventory_units (serial_normalized) where serial_normalized is not null;
create unique index inventory_units_chassis on inventory.inventory_units (chassis_normalized) where chassis_normalized is not null;
create index inventory_units_product on inventory.inventory_units (product_id, state, id);

create table inventory.quantity_balances (
  product_id uuid primary key references inventory.products(id),
  on_hand integer not null default 0 check (on_hand >= 0),
  reserved integer not null default 0 check (reserved >= 0),
  committed integer not null default 0 check (committed >= 0),
  inspection integer not null default 0 check (inspection >= 0),
  maintenance integer not null default 0 check (maintenance >= 0),
  check (reserved + committed + inspection + maintenance <= on_hand)
);

create table inventory.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references inventory.products(id),
  unit_id uuid references inventory.inventory_units(id),
  quantity integer not null check (quantity > 0),
  quantity_delta integer not null,
  kind text not null check (kind in ('RECEIPT', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'RECOUNT_IN', 'RECOUNT_OUT')),
  state_from text, state_to text,
  cost_snapshot_cents bigint check (cost_snapshot_cents >= 0),
  supplier_contact_id uuid references crm.contacts(id),
  supplier_snapshot jsonb,
  purchase_document_reference text,
  reason text not null check (btrim(reason) <> ''),
  actor_id uuid not null references identity.profiles(id),
  effect_key text not null unique,
  reversal_of_id uuid references inventory.inventory_movements(id),
  created_at timestamptz not null default now(),
  check (unit_id is null or quantity = 1),
  check (quantity_delta in (quantity, -quantity, 0))
);
create index inventory_movements_product on inventory.inventory_movements (product_id, created_at, id);
create index inventory_movements_unit on inventory.inventory_movements (unit_id, created_at, id);
create trigger inventory_movements_append_only before update or delete on inventory.inventory_movements
  for each row execute function audit.forbid_mutation();
alter table inventory.inventory_units add constraint inventory_units_receipt
  foreign key (receipt_movement_id) references inventory.inventory_movements(id);

create table integrations.files (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references inventory.products(id),
  bucket text not null,
  object_path text not null unique,
  state text not null default 'PENDING' check (state in ('PENDING', 'READY', 'REJECTED')),
  declared_content_type text not null check (declared_content_type in ('image/jpeg', 'image/png', 'image/webp')),
  declared_size_bytes integer not null check (declared_size_bytes between 1 and 8388608),
  content_type text, size_bytes integer, sha256 text,
  position integer not null default 0,
  caption text,
  created_by uuid not null references identity.profiles(id),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index files_product on integrations.files (product_id, state, position);
alter table inventory.products add constraint products_primary_photo
  foreign key (primary_photo_id) references integrations.files(id);

-- ---------------------------------------------------------------- projeções
create or replace function inventory.counts(p inventory.products)
returns jsonb language sql stable security definer set search_path = '' as $$
  select case
    when p.inventory_opening_state <> 'CONFIRMED' or p.tracking is null then
      jsonb_build_object('known', false, 'reason', 'opening_not_confirmed', 'physical_on_hand', null,
                         'available', null, 'reserved', null, 'committed', null, 'inspection_maintenance', null)
    when p.tracking = 'UNIT' then (
      select jsonb_build_object('known', true,
        'physical_on_hand', count(*) filter (where state in ('IN_STOCK','RESERVED','COMMITTED','INSPECTION','MAINTENANCE')),
        'available', count(*) filter (where state = 'IN_STOCK'),
        'reserved', count(*) filter (where state = 'RESERVED'),
        'committed', count(*) filter (where state = 'COMMITTED'),
        'inspection_maintenance', count(*) filter (where state in ('INSPECTION','MAINTENANCE')))
      from inventory.inventory_units u where u.product_id = p.id)
    else (
      select jsonb_build_object('known', true, 'physical_on_hand', coalesce(b.on_hand, 0),
        'available', coalesce(b.on_hand - b.reserved - b.committed - b.inspection - b.maintenance, 0),
        'reserved', coalesce(b.reserved, 0), 'committed', coalesce(b.committed, 0),
        'inspection_maintenance', coalesce(b.inspection + b.maintenance, 0))
      from (select 1) x left join inventory.quantity_balances b on b.product_id = p.id)
  end
$$;

-- Projeção do produto. Custo, fornecedor e localização de custo só com inventory.cost.read.
create or replace function inventory.product_json(p inventory.products, p_role text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', p.id, 'name', p.name, 'sku', p.sku,
    'type', case p.tracking when 'UNIT' then 'BIKE' when 'QUANTITY' then 'ACCESSORY' end,
    'active', p.active, 'migration_pending', p.migration_pending, 'opening_state', p.inventory_opening_state,
    'sale_price_cents', case when p.sale_price_cents is null then null else p.sale_price_cents::text end,
    'brand', p.brand, 'category', p.category, 'size', p.size, 'color', p.color,
    'measurement_unit', p.measurement_unit, 'warranty_note', p.warranty_note,
    'minimum_stock', p.minimum_stock, 'location', p.location, 'variant_description', p.variant_description,
    'primary_photo_id', p.primary_photo_id,
    'counts', inventory.counts(p),
    'inventory_version', p.inventory_version, 'version', p.version,
    'created_at', p.created_at, 'updated_at', p.updated_at)
  || case when 'inventory.cost.read' = any(identity.role_permissions(p_role)) then jsonb_build_object(
       'reference_cost_cents', case when p.reference_cost_cents is null then null else p.reference_cost_cents::text end,
       'supplier_contact_id', p.preferred_supplier_contact_id,
       'supplier_name', (select name from crm.contacts where id = p.preferred_supplier_contact_id))
     else '{}'::jsonb end
$$;

create or replace function api.product_list(p_actor uuid, p jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_role text := identity.require_actor(p_actor, 'catalog.read');
        v_limit int := least(greatest(coalesce((p->>'limit')::int, 50), 1), 100);
        v_q text := nullif(btrim(p->>'q'), ''); v_rows jsonb; v_more boolean;
begin
  with page as (
    select * from inventory.products x
     where (coalesce((p->>'include_archived')::boolean, false) or x.active)
       and (v_q is null or x.name ilike '%' || v_q || '%' or x.sku ilike '%' || v_q || '%' or x.brand ilike '%' || v_q || '%')
       and (p->>'type' is null or x.tracking = case p->>'type' when 'BIKE' then 'UNIT' else 'QUANTITY' end)
       and (p->>'cursor_name' is null or (x.name, x.id) > (p->>'cursor_name', (p->>'cursor_id')::uuid))
     order by x.name, x.id limit v_limit + 1)
  select coalesce(jsonb_agg(inventory.product_json(page, v_role) order by page.name, page.id), '[]'::jsonb), count(*) > v_limit
    into v_rows, v_more from page;
  if v_more then v_rows := v_rows - (jsonb_array_length(v_rows) - 1); end if;
  return jsonb_build_object('data', v_rows, 'has_more', v_more);
end $$;

create or replace function api.product_get(p_actor uuid, p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_role text := identity.require_actor(p_actor, 'catalog.read'); x inventory.products%rowtype;
        v_cost boolean;
begin
  select * into x from inventory.products where id = p_id;
  if not found then perform api.fail('NOT_FOUND'); end if;
  v_cost := 'inventory.cost.read' = any(identity.role_permissions(v_role));
  return inventory.product_json(x, v_role) || jsonb_build_object(
    'photos', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'position', f.position, 'caption', f.caption)
                 order by f.position, f.created_at) from integrations.files f where f.product_id = p_id and f.state = 'READY'), '[]'::jsonb),
    'units', case when x.tracking = 'UNIT' then coalesce((select jsonb_agg(jsonb_build_object(
                 'id', u.id, 'internal_code', u.internal_code, 'serial_number', u.serial_normalized,
                 'chassis_number', u.chassis_normalized, 'state', u.state, 'version', u.version, 'created_at', u.created_at)
                 || case when v_cost then jsonb_build_object('acquisition_cost_cents', u.acquisition_cost_cents::text,
                         'supplier_contact_id', u.supplier_contact_id) else '{}'::jsonb end
                 order by u.created_at, u.internal_code)
               from inventory.inventory_units u where u.product_id = p_id and u.state not in ('DELIVERED', 'WRITTEN_OFF')), '[]'::jsonb)
             else null end,
    'movements', case when 'inventory.manage' = any(identity.role_permissions(v_role)) then coalesce((select jsonb_agg(
                 jsonb_build_object('id', m.id, 'kind', m.kind, 'quantity_delta', m.quantity_delta, 'quantity', m.quantity,
                   'unit_code', u.internal_code, 'reason', m.reason, 'actor_name', pr.name, 'created_at', m.created_at,
                   'cost_snapshot_cents', m.cost_snapshot_cents::text, 'purchase_document_reference', m.purchase_document_reference)
                 order by m.created_at desc, m.id)
               from (select * from inventory.inventory_movements where product_id = p_id order by created_at desc limit 200) m
               left join inventory.inventory_units u on u.id = m.unit_id
               join identity.profiles pr on pr.id = m.actor_id), '[]'::jsonb) else null end);
end $$;

-- ---------------------------------------------------------------- movimentos
create or replace function inventory.check_supplier(p_contact uuid) returns void language plpgsql as $$
begin
  if p_contact is not null and not exists (select 1 from crm.contact_roles where contact_id = p_contact
                                            and role = 'SUPPLIER' and active) then
    perform api.fail('VALIDATION_FAILED', jsonb_build_object('field', 'supplier_contact_id', 'reason', 'not_supplier'));
  end if;
end $$;

-- Entrada de N peças: bikes viram N unidades (cada uma com movimento próprio); acessórios um movimento +N.
create or replace function inventory.receive(p_ctx jsonb, x inventory.products, p_qty int, p_kind text, p_reason text,
                                             p_units jsonb, p_cost bigint, p_supplier uuid, p_doc text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (p_ctx->>'actor_id')::uuid; i int; v_unit uuid; v_mov uuid; v_serial text;
        v_snapshot jsonb;
begin
  if p_qty <= 0 then return; end if;
  perform inventory.check_supplier(p_supplier);
  v_snapshot := case when p_supplier is null then null else
    (select jsonb_build_object('name', name, 'cnpj', cnpj, 'cpf', cpf) from crm.contacts where id = p_supplier) end;
  if x.tracking = 'UNIT' then
    for i in 1..p_qty loop
      v_serial := nullif(p_units->(i - 1)->>'serial_number', '');
      begin
        insert into inventory.inventory_units (product_id, internal_code, serial_normalized, state, acquisition_cost_cents,
                                               supplier_contact_id)
        values (x.id, 'BK-' || lpad(nextval('inventory.unit_code_seq')::text, 6, '0'), v_serial, 'IN_STOCK', p_cost, p_supplier)
        returning id into v_unit;
      exception when unique_violation then
        perform api.fail('VALIDATION_FAILED', jsonb_build_object('field', 'serial_number', 'reason', 'duplicate', 'index', i - 1));
      end;
      insert into inventory.inventory_movements (product_id, unit_id, quantity, quantity_delta, kind, state_to,
             cost_snapshot_cents, supplier_contact_id, supplier_snapshot, purchase_document_reference, reason, actor_id, effect_key)
      values (x.id, v_unit, 1, 1, p_kind, 'IN_STOCK', p_cost, p_supplier, v_snapshot, p_doc, p_reason, v_actor,
              (p_ctx->>'effect_base') || ':' || p_kind || ':' || i)
      returning id into v_mov;
      update inventory.inventory_units set receipt_movement_id = v_mov where id = v_unit;
    end loop;
  else
    insert into inventory.quantity_balances (product_id) values (x.id) on conflict do nothing;
    update inventory.quantity_balances set on_hand = on_hand + p_qty where product_id = x.id;
    insert into inventory.inventory_movements (product_id, quantity, quantity_delta, kind, cost_snapshot_cents,
           supplier_contact_id, supplier_snapshot, purchase_document_reference, reason, actor_id, effect_key)
    values (x.id, p_qty, p_qty, p_kind, p_cost, p_supplier, v_snapshot, p_doc, p_reason, v_actor,
            (p_ctx->>'effect_base') || ':' || p_kind);
  end if;
end $$;

create or replace function api.product_create(p_ctx jsonb, p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (p_ctx->>'actor_id')::uuid; v_qty int := coalesce((p->>'initial_quantity')::int, 0);
        x inventory.products%rowtype;
begin
  perform identity.require_actor(v_actor, 'catalog.manage');
  if v_qty > 0 then perform identity.require_actor(v_actor, 'inventory.manage'); end if;
  perform inventory.check_supplier((p->>'supplier_contact_id')::uuid);
  begin
    insert into inventory.products (name, sku, tracking, inventory_opening_state, sale_price_cents, reference_cost_cents,
      brand, category, size, color, measurement_unit, warranty_note, preferred_supplier_contact_id, minimum_stock, location,
      variant_description)
    values (btrim(p->>'name'), coalesce(nullif(btrim(p->>'sku'), ''), 'NB-' || lpad(nextval('inventory.sku_seq')::text, 5, '0')),
      p->>'tracking', 'CONFIRMED', (p->>'sale_price_cents')::bigint, (p->>'acquisition_cost_cents')::bigint,
      p->>'brand', p->>'category', p->>'size', p->>'color', p->>'measurement_unit', p->>'warranty_note',
      (p->>'supplier_contact_id')::uuid, (p->>'minimum_stock')::int, p->>'location', p->>'variant_description')
    returning * into x;
  exception when unique_violation then
    perform api.fail('VALIDATION_FAILED', jsonb_build_object('field', 'sku', 'reason', 'duplicate'));
  end;
  if x.tracking = 'QUANTITY' then insert into inventory.quantity_balances (product_id) values (x.id); end if;
  perform inventory.receive(p_ctx, x, v_qty, 'RECEIPT', 'Quantidade inicial do cadastro', p->'initial_units',
                            (p->>'acquisition_cost_cents')::bigint, (p->>'supplier_contact_id')::uuid, null);
  perform audit.record(p_ctx, 'product.created', 'product', x.id, jsonb_build_object('initial_quantity', v_qty));
  return jsonb_build_object('id', x.id, 'version', x.version, 'sku', x.sku);
end $$;

create or replace function api.product_update(p_ctx jsonb, p_id uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (p_ctx->>'actor_id')::uuid; x inventory.products%rowtype;
begin
  perform identity.require_actor(v_actor, 'catalog.manage');
  select * into x from inventory.products where id = p_id for update;
  if not found then perform api.fail('NOT_FOUND'); end if;
  if x.version <> (p->>'expected_version')::int then
    perform api.fail('VERSION_CONFLICT', jsonb_build_object('current_version', x.version));
  end if;
  if p ? 'tracking' and x.tracking is not null and p->>'tracking' is distinct from x.tracking then
    perform api.fail('VALIDATION_FAILED', jsonb_build_object('field', 'type', 'reason', 'immutable_after_set'));
  end if;
  if p ? 'supplier_contact_id' then perform inventory.check_supplier((p->>'supplier_contact_id')::uuid); end if;
  if p->>'photo_attachment_id' is not null and not exists (select 1 from integrations.files
       where id = (p->>'photo_attachment_id')::uuid and product_id = p_id and state = 'READY') then
    perform api.fail('VALIDATION_FAILED', jsonb_build_object('field', 'photo_attachment_id', 'reason', 'not_ready'));
  end if;
  begin
    update inventory.products set
      name = case when p ? 'name' then btrim(p->>'name') else name end,
      sku = case when p ? 'sku' then coalesce(nullif(btrim(p->>'sku'), ''), sku) else sku end,
      tracking = case when p ? 'tracking' then p->>'tracking' else tracking end,
      sale_price_cents = case when p ? 'sale_price_cents' then (p->>'sale_price_cents')::bigint else sale_price_cents end,
      reference_cost_cents = case when p ? 'reference_cost_cents' then (p->>'reference_cost_cents')::bigint else reference_cost_cents end,
      primary_photo_id = case when p ? 'photo_attachment_id' then (p->>'photo_attachment_id')::uuid else primary_photo_id end,
      brand = case when p ? 'brand' then p->>'brand' else brand end,
      category = case when p ? 'category' then p->>'category' else category end,
      size = case when p ? 'size' then p->>'size' else size end,
      color = case when p ? 'color' then p->>'color' else color end,
      measurement_unit = case when p ? 'measurement_unit' then p->>'measurement_unit' else measurement_unit end,
      warranty_note = case when p ? 'warranty_note' then p->>'warranty_note' else warranty_note end,
      preferred_supplier_contact_id = case when p ? 'supplier_contact_id' then (p->>'supplier_contact_id')::uuid else preferred_supplier_contact_id end,
      minimum_stock = case when p ? 'minimum_stock' then (p->>'minimum_stock')::int else minimum_stock end,
      location = case when p ? 'location' then p->>'location' else location end,
      variant_description = case when p ? 'variant_description' then p->>'variant_description' else variant_description end,
      version = version + 1, updated_at = now()
    where id = p_id;
  exception when unique_violation then
    perform api.fail('VALIDATION_FAILED', jsonb_build_object('field', 'sku', 'reason', 'duplicate'));
  end;
  perform audit.record(p_ctx, 'product.updated', 'product', p_id,
    jsonb_build_object('fields', (select jsonb_agg(k) from jsonb_object_keys(p - 'expected_version') k)));
  return jsonb_build_object('id', p_id, 'version', x.version + 1);
end $$;

create or replace function api.product_archive(p_ctx jsonb, p_id uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (p_ctx->>'actor_id')::uuid; x inventory.products%rowtype;
begin
  perform identity.require_actor(v_actor, 'catalog.manage');
  select * into x from inventory.products where id = p_id for update;
  if not found then perform api.fail('NOT_FOUND'); end if;
  if x.version <> (p->>'expected_version')::int then perform api.fail('VERSION_CONFLICT'); end if;
  update inventory.products set active = false, archived_reason = btrim(p->>'reason'), version = version + 1, updated_at = now()
   where id = p_id;
  perform audit.record(p_ctx, 'product.archived', 'product', p_id, jsonb_build_object('reason', p->>'reason'));
  return jsonb_build_object('id', p_id, 'version', x.version + 1);
end $$;

create or replace function inventory.lock_for_stock(p_ctx jsonb, p_product uuid, p_expected int)
returns inventory.products language plpgsql security definer set search_path = '' as $$
declare x inventory.products%rowtype;
begin
  perform identity.require_actor((p_ctx->>'actor_id')::uuid, 'inventory.manage');
  select * into x from inventory.products where id = p_product for update;
  if not found then perform api.fail('NOT_FOUND'); end if;
  if x.inventory_version <> p_expected then
    perform api.fail('VERSION_CONFLICT', jsonb_build_object('resource', 'inventory', 'current_version', x.inventory_version));
  end if;
  if not x.active then perform api.fail('VALIDATION_FAILED', jsonb_build_object('reason', 'product_archived')); end if;
  if x.tracking is null then perform api.fail('VALIDATION_FAILED', jsonb_build_object('field', 'type', 'reason', 'tracking_pending')); end if;
  update inventory.products set inventory_version = inventory_version + 1, updated_at = now() where id = p_product;
  return x;
end $$;

create or replace function api.stock_receipt(p_ctx jsonb, p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare x inventory.products%rowtype;
begin
  x := inventory.lock_for_stock(p_ctx, (p->>'product_id')::uuid, (p->>'expected_inventory_version')::int);
  if x.inventory_opening_state <> 'CONFIRMED' then
    perform api.fail('VALIDATION_FAILED', jsonb_build_object('reason', 'opening_not_confirmed'));
  end if;
  perform inventory.receive(p_ctx, x, (p->>'quantity')::int, 'RECEIPT', btrim(p->>'reason'), p->'units',
          (p->>'unit_acquisition_cost_cents')::bigint, (p->>'supplier_contact_id')::uuid, p->>'purchase_document_reference');
  perform audit.record(p_ctx, 'stock.received', 'product', x.id, jsonb_build_object('quantity', (p->>'quantity')::int));
  return jsonb_build_object('product_id', x.id, 'inventory_version', x.inventory_version + 1);
end $$;

-- Baixa unidades IN_STOCK identificadas (sem escolher bike silenciosamente) ou saldo de acessórios.
create or replace function inventory.write_off(p_ctx jsonb, x inventory.products, p_qty int, p_unit_ids uuid[],
                                               p_kind text, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (p_ctx->>'actor_id')::uuid; u record; v_n int := 0;
begin
  if x.tracking = 'UNIT' then
    if coalesce(array_length(p_unit_ids, 1), 0) <> p_qty then
      perform api.fail('VALIDATION_FAILED', jsonb_build_object('field', 'unit_ids', 'reason', 'must_identify_each_unit'));
    end if;
    for u in select * from inventory.inventory_units where id = any(p_unit_ids) order by id for update loop
      if u.product_id <> x.id or u.state <> 'IN_STOCK' then
        perform api.fail('RESERVATION_CONFLICT', jsonb_build_object('unit_id', u.id, 'state', u.state));
      end if;
      v_n := v_n + 1;
      update inventory.inventory_units set state = 'WRITTEN_OFF', version = version + 1, updated_at = now() where id = u.id;
      insert into inventory.inventory_movements (product_id, unit_id, quantity, quantity_delta, kind, state_from, state_to,
             cost_snapshot_cents, reason, actor_id, effect_key)
      values (x.id, u.id, 1, -1, p_kind, 'IN_STOCK', 'WRITTEN_OFF', u.acquisition_cost_cents, p_reason, v_actor,
              (p_ctx->>'effect_base') || ':' || p_kind || ':' || u.id);
    end loop;
    if v_n <> p_qty then perform api.fail('VALIDATION_FAILED', jsonb_build_object('field', 'unit_ids', 'reason', 'unknown_unit')); end if;
  else
    begin
      update inventory.quantity_balances set on_hand = on_hand - p_qty where product_id = x.id;
    exception when check_violation then
      perform api.fail('RESERVATION_CONFLICT', jsonb_build_object('reason', 'below_committed_or_zero'));
    end;
    insert into inventory.inventory_movements (product_id, quantity, quantity_delta, kind, reason, actor_id, effect_key)
    values (x.id, p_qty, -p_qty, p_kind, p_reason, v_actor, (p_ctx->>'effect_base') || ':' || p_kind);
  end if;
end $$;

create or replace function api.stock_adjustment(p_ctx jsonb, p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare x inventory.products%rowtype; v_delta int := (p->>'quantity_delta')::int;
begin
  x := inventory.lock_for_stock(p_ctx, (p->>'product_id')::uuid, (p->>'expected_inventory_version')::int);
  if x.inventory_opening_state <> 'CONFIRMED' then
    perform api.fail('VALIDATION_FAILED', jsonb_build_object('reason', 'opening_not_confirmed'));
  end if;
  if v_delta > 0 then
    perform inventory.receive(p_ctx, x, v_delta, 'ADJUSTMENT_IN', btrim(p->>'reason'), null, null, null, null);
  else
    perform inventory.write_off(p_ctx, x, -v_delta,
      (select array_agg(e::uuid) from jsonb_array_elements_text(p->'unit_ids') e), 'ADJUSTMENT_OUT', btrim(p->>'reason'));
  end if;
  perform audit.record(p_ctx, 'stock.adjusted', 'product', x.id, jsonb_build_object('quantity_delta', v_delta));
  return jsonb_build_object('product_id', x.id, 'inventory_version', x.inventory_version + 1);
end $$;

-- Recontagem: registra a diferença como movimento compensatório. Unidades comprometidas ausentes abrem divergência.
create or replace function api.stock_recount(p_ctx jsonb, p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare x inventory.products%rowtype; v_counted int := (p->>'counted_quantity')::int; v_current int;
        v_observed uuid[]; v_missing uuid[]; v_bad int; v_reason text := btrim(p->>'reason');
begin
  x := inventory.lock_for_stock(p_ctx, (p->>'product_id')::uuid, (p->>'expected_inventory_version')::int);
  if x.inventory_opening_state <> 'CONFIRMED' then
    if not coalesce((p->>'confirm_initial_opening')::boolean, false) then
      perform api.fail('VALIDATION_FAILED', jsonb_build_object('reason', 'opening_not_confirmed'));
    end if;
    update inventory.products set inventory_opening_state = 'CONFIRMED' where id = x.id;
    if x.tracking = 'QUANTITY' then insert into inventory.quantity_balances (product_id) values (x.id) on conflict do nothing; end if;
    perform inventory.receive(p_ctx, x, v_counted, 'RECOUNT_IN', v_reason, p->'initial_units',
                              (p->>'unit_acquisition_cost_cents')::bigint, null, null);
    perform audit.record(p_ctx, 'stock.opening_confirmed', 'product', x.id, jsonb_build_object('counted', v_counted));
    return jsonb_build_object('product_id', x.id, 'inventory_version', x.inventory_version + 1, 'difference', v_counted);
  end if;
  if x.tracking = 'UNIT' then
    select count(*) into v_current from inventory.inventory_units
     where product_id = x.id and state in ('IN_STOCK','RESERVED','COMMITTED','INSPECTION','MAINTENANCE');
    if v_counted < v_current then
      v_observed := coalesce((select array_agg(e::uuid) from jsonb_array_elements_text(p->'observed_unit_ids') e), '{}');
      if array_length(v_observed, 1) is distinct from nullif(v_counted, 0) then
        perform api.fail('VALIDATION_FAILED', jsonb_build_object('field', 'observed_unit_ids', 'reason', 'must_list_counted_units'));
      end if;
      select array_agg(id) into v_missing from inventory.inventory_units
       where product_id = x.id and state in ('IN_STOCK','RESERVED','COMMITTED','INSPECTION','MAINTENANCE')
         and not (id = any(v_observed));
      select count(*) into v_bad from inventory.inventory_units where id = any(v_missing) and state <> 'IN_STOCK';
      if v_bad > 0 then
        perform api.fail('RESERVATION_CONFLICT', jsonb_build_object('reason', 'missing_units_reserved_or_committed'));
      end if;
      perform inventory.write_off(p_ctx, x, v_current - v_counted, v_missing, 'RECOUNT_OUT', v_reason);
    elsif v_counted > v_current then
      perform inventory.receive(p_ctx, x, v_counted - v_current, 'RECOUNT_IN', v_reason, p->'initial_units',
                                (p->>'unit_acquisition_cost_cents')::bigint, null, null);
    end if;
  else
    select on_hand into v_current from inventory.quantity_balances where product_id = x.id;
    if v_counted < v_current then
      perform inventory.write_off(p_ctx, x, v_current - v_counted, null, 'RECOUNT_OUT', v_reason);
    elsif v_counted > v_current then
      perform inventory.receive(p_ctx, x, v_counted - v_current, 'RECOUNT_IN', v_reason, null,
                                (p->>'unit_acquisition_cost_cents')::bigint, null, null);
    end if;
  end if;
  perform audit.record(p_ctx, 'stock.recounted', 'product', x.id,
    jsonb_build_object('counted', v_counted, 'previous', v_current));
  return jsonb_build_object('product_id', x.id, 'inventory_version', x.inventory_version + 1, 'difference', v_counted - v_current);
end $$;

create or replace function api.unit_identification(p_ctx jsonb, p_unit uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (p_ctx->>'actor_id')::uuid; u inventory.inventory_units%rowtype;
begin
  perform identity.require_actor(v_actor, 'inventory.manage');
  select * into u from inventory.inventory_units where id = p_unit for update;
  if not found then perform api.fail('NOT_FOUND'); end if;
  if u.version <> (p->>'expected_version')::int then perform api.fail('VERSION_CONFLICT'); end if;
  begin
    update inventory.inventory_units set
      serial_normalized = case when p ? 'serial_number' then p->>'serial_number' else serial_normalized end,
      chassis_normalized = case when p ? 'chassis_number' then p->>'chassis_number' else chassis_normalized end,
      version = version + 1, updated_at = now()
    where id = p_unit;
  exception when unique_violation then
    perform api.fail('VALIDATION_FAILED', jsonb_build_object('field', 'serial_number', 'reason', 'duplicate'));
  end;
  perform audit.record(p_ctx, 'unit.identified', 'inventory_unit', p_unit,
    jsonb_build_object('before', jsonb_build_object('serial', u.serial_normalized, 'chassis', u.chassis_normalized)));
  return jsonb_build_object('id', p_unit, 'version', u.version + 1);
end $$;

-- ---------------------------------------------------------------- fotos privadas
create or replace function api.file_register(p_ctx jsonb, p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (p_ctx->>'actor_id')::uuid; v_id uuid := gen_random_uuid(); v_path text;
begin
  perform identity.require_actor(v_actor, 'catalog.manage');
  if not exists (select 1 from inventory.products where id = (p->>'product_id')::uuid) then perform api.fail('NOT_FOUND'); end if;
  v_path := 'products/' || (p->>'product_id') || '/' || v_id::text;
  insert into integrations.files (id, product_id, bucket, object_path, declared_content_type, declared_size_bytes, created_by, position)
  values (v_id, (p->>'product_id')::uuid, p->>'bucket', v_path, p->>'content_type', (p->>'size_bytes')::int, v_actor,
          (select coalesce(max(position) + 1, 0) from integrations.files where product_id = (p->>'product_id')::uuid));
  return jsonb_build_object('id', v_id, 'bucket', p->>'bucket', 'object_path', v_path);
end $$;

create or replace function api.file_get(p_actor uuid, p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_role text := identity.require_actor(p_actor, 'catalog.read'); f integrations.files%rowtype;
begin
  select * into f from integrations.files where id = p_id;
  if not found or f.product_id is null then perform api.fail('NOT_FOUND'); end if;
  if f.state <> 'READY' and not ('catalog.manage' = any(identity.role_permissions(v_role))) then perform api.fail('NOT_FOUND'); end if;
  return jsonb_build_object('id', f.id, 'bucket', f.bucket, 'object_path', f.object_path, 'state', f.state,
                            'declared_content_type', f.declared_content_type, 'declared_size_bytes', f.declared_size_bytes);
end $$;

-- O adaptador verificou bytes/tipo/tamanho/hash do objeto antes de chamar; aqui só a transição PENDING → READY|REJECTED.
create or replace function api.file_complete(p_ctx jsonb, p_id uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (p_ctx->>'actor_id')::uuid; f integrations.files%rowtype;
begin
  perform identity.require_actor(v_actor, 'catalog.manage');
  select * into f from integrations.files where id = p_id for update;
  if not found then perform api.fail('NOT_FOUND'); end if;
  if f.state = 'READY' then return jsonb_build_object('id', p_id, 'state', 'READY'); end if;
  update integrations.files set state = case when (p->>'accepted')::boolean then 'READY' else 'REJECTED' end,
         content_type = p->>'content_type', size_bytes = (p->>'size_bytes')::int, sha256 = p->>'sha256', completed_at = now()
   where id = p_id;
  if (p->>'accepted')::boolean then
    update inventory.products set primary_photo_id = coalesce(primary_photo_id, p_id), updated_at = now()
     where id = f.product_id and primary_photo_id is null;
    perform audit.record(p_ctx, 'product.photo_added', 'product', f.product_id, jsonb_build_object('file_id', p_id));
  end if;
  return jsonb_build_object('id', p_id, 'state', case when (p->>'accepted')::boolean then 'READY' else 'REJECTED' end);
end $$;
