-- NINEBIKE OS — T10 (parte interna, sem PSP): despesas/contas a pagar, baixas e resultado gerencial.
-- Somente OWNER (permissão finance.manage). Baixa administrativa não confirma recebimento de venda.
-- Resultado gerencial: receita por pedido confirmado (competência), CMV pelo custo histórico do pedido,
-- comissões da equipe e despesas por competência. Custo ausente torna o resultado PARCIAL — nunca vira zero.

create or replace function identity.role_permissions(p_role text)
returns text[] language sql immutable as $$
  select case p_role
    when 'SELLER' then array['crm.read','crm.write','catalog.read','inventory.read']
    when 'OWNER' then array['crm.read','crm.write','crm.manage','pipeline.manage','suppliers.read',
                            'suppliers.write','catalog.read','catalog.manage','inventory.read',
                            'inventory.manage','inventory.cost.read','users.manage','audit.read','finance.manage']
    else array[]::text[] end
$$;

create table finance.expense_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (btrim(name) <> '' and length(name) <= 60),
  kind text not null check (kind in ('OPERATING', 'COST_OF_GOODS', 'TAX', 'FINANCIAL', 'NON_RESULT')),
  active boolean not null default true,
  position integer not null default 0
);
insert into finance.expense_categories (name, kind, position) values
  ('Aluguel', 'OPERATING', 1), ('Energia e água', 'OPERATING', 2), ('Internet e telefone', 'OPERATING', 3),
  ('Salários e encargos', 'OPERATING', 4), ('Marketing e anúncios', 'OPERATING', 5), ('Sistemas e assinaturas', 'OPERATING', 6),
  ('Manutenção e oficina', 'OPERATING', 7), ('Frete e entregas', 'OPERATING', 8), ('Contador', 'OPERATING', 9),
  ('Compra de mercadoria', 'NON_RESULT', 10), ('Impostos', 'TAX', 11), ('Tarifas bancárias e cartão', 'FINANCIAL', 12),
  ('Outras despesas', 'OPERATING', 13), ('Retirada dos sócios', 'NON_RESULT', 14);

create table finance.expenses (
  id uuid primary key default gen_random_uuid(),
  description text not null check (btrim(description) <> '' and length(description) <= 200),
  category_id uuid not null references finance.expense_categories(id),
  supplier_contact_id uuid references crm.contacts(id),
  amount_cents bigint not null check (amount_cents > 0),
  competence_month date not null check (extract(day from competence_month) = 1),
  due_date date not null,
  note text check (length(note) <= 1000),
  state text not null default 'OPEN' check (state in ('OPEN', 'CANCELLED')),
  version integer not null default 1,
  created_by uuid not null references identity.profiles(id),
  created_at timestamptz not null default now()
);
create index expenses_due on finance.expenses (state, due_date);
create index expenses_competence on finance.expenses (competence_month);

create table finance.expense_payments (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references finance.expenses(id),
  amount_cents bigint not null check (amount_cents > 0),
  paid_on date not null,
  method text not null check (method in ('PIX', 'BOLETO', 'CARD', 'CASH', 'TRANSFER', 'OTHER')),
  note text check (length(note) <= 300),
  reversed_at timestamptz, reversed_by uuid references identity.profiles(id), reversed_reason text,
  created_by uuid not null references identity.profiles(id),
  created_at timestamptz not null default now()
);

create or replace function finance.expense_json(e finance.expenses) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', e.id, 'description', e.description, 'category_id', e.category_id,
    'category_name', c.name, 'category_kind', c.kind, 'supplier_contact_id', e.supplier_contact_id,
    'supplier_name', (select name from crm.contacts where id = e.supplier_contact_id),
    'amount_cents', e.amount_cents::text, 'paid_cents', p.paid::text, 'open_cents', (e.amount_cents - p.paid)::text,
    'competence_month', e.competence_month, 'due_date', e.due_date, 'note', e.note, 'state', e.state,
    'payment_state', case when e.state = 'CANCELLED' then 'CANCELLED' when p.paid = 0 then 'OPEN'
                          when p.paid < e.amount_cents then 'PARTIAL' else 'PAID' end,
    'overdue', e.state = 'OPEN' and p.paid < e.amount_cents and e.due_date < (now() at time zone 'America/Sao_Paulo')::date,
    'version', e.version, 'created_at', e.created_at,
    'payments', (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'amount_cents', x.amount_cents::text, 'paid_on', x.paid_on,
        'method', x.method, 'note', x.note, 'reversed_at', x.reversed_at, 'reversed_reason', x.reversed_reason) order by x.paid_on, x.created_at), '[]'::jsonb)
       from finance.expense_payments x where x.expense_id = e.id))
  from finance.expense_categories c,
       lateral (select coalesce(sum(amount_cents), 0) paid from finance.expense_payments where expense_id = e.id and reversed_at is null) p
  where c.id = e.category_id
$$;

create or replace function api.expense_categories(p_actor uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform identity.require_actor(p_actor, 'finance.manage');
  return (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'kind', kind) order by position, name), '[]'::jsonb)
            from finance.expense_categories where active);
end $$;

create or replace function api.expense_list(p_actor uuid, p jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_status text := p->>'status';
begin
  perform identity.require_actor(p_actor, 'finance.manage');
  return (select coalesce(jsonb_agg(j order by (j->>'due_date'), j->>'id'), '[]'::jsonb) from (
    select finance.expense_json(e) j from finance.expenses e
     where (p->>'from' is null or e.due_date >= (p->>'from')::date) and (p->>'to' is null or e.due_date < (p->>'to')::date)
       and (p->>'category_id' is null or e.category_id = (p->>'category_id')::uuid)) t
   where v_status is null or (v_status = 'OPEN' and j->>'payment_state' in ('OPEN', 'PARTIAL'))
      or (v_status = 'OVERDUE' and (j->>'overdue')::boolean) or j->>'payment_state' = v_status);
end $$;

create or replace function api.expense_create(p_ctx jsonb, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (p_ctx->>'actor_id')::uuid; e finance.expenses%rowtype; i int; v_n int := coalesce((p->>'installments')::int, 1);
        v_ids jsonb := '[]'::jsonb; v_part bigint; v_total bigint := (p->>'amount_cents')::bigint;
begin
  perform identity.require_actor(v_actor, 'finance.manage');
  if not exists (select 1 from finance.expense_categories where id = (p->>'category_id')::uuid and active) then
    perform api.fail('VALIDATION_FAILED', jsonb_build_object('field', 'category_id', 'reason', 'unknown'));
  end if;
  if p->>'supplier_contact_id' is not null and not exists (select 1 from crm.contact_roles where contact_id = (p->>'supplier_contact_id')::uuid and role = 'SUPPLIER') then
    perform api.fail('VALIDATION_FAILED', jsonb_build_object('field', 'supplier_contact_id', 'reason', 'not_a_supplier'));
  end if;
  -- Parcelas mensais: o resto dos centavos vai para a primeira; competência e vencimento avançam um mês cada.
  for i in 0 .. v_n - 1 loop
    v_part := v_total / v_n + case when i = 0 then v_total % v_n else 0 end;
    insert into finance.expenses (description, category_id, supplier_contact_id, amount_cents, competence_month, due_date, note, created_by)
    values (btrim(p->>'description') || case when v_n > 1 then format(' (%s/%s)', i + 1, v_n) else '' end,
            (p->>'category_id')::uuid, (p->>'supplier_contact_id')::uuid, v_part,
            (date_trunc('month', (p->>'competence_month')::date) + make_interval(months => i))::date,
            ((p->>'due_date')::date + make_interval(months => i))::date, nullif(btrim(p->>'note'), ''), v_actor)
    returning * into e;
    v_ids := v_ids || to_jsonb(e.id);
    perform audit.record(p_ctx, 'expense.created', 'expense', e.id, jsonb_build_object('amount_cents', v_part::text));
  end loop;
  return jsonb_build_object('ids', v_ids);
end $$;

create or replace function api.expense_cancel(p_ctx jsonb, p_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare e finance.expenses%rowtype;
begin
  perform identity.require_actor((p_ctx->>'actor_id')::uuid, 'finance.manage');
  select * into e from finance.expenses where id = p_id for update;
  if not found then perform api.fail('NOT_FOUND'); end if;
  if e.version <> (p->>'expected_version')::int then perform api.fail('VERSION_CONFLICT'); end if;
  if exists (select 1 from finance.expense_payments where expense_id = p_id and reversed_at is null) then
    perform api.fail('VERSION_CONFLICT', jsonb_build_object('reason', 'has_payments'));
  end if;
  update finance.expenses set state = 'CANCELLED', version = version + 1 where id = p_id;
  perform audit.record(p_ctx, 'expense.cancelled', 'expense', p_id, jsonb_build_object('reason', p->>'reason'));
  return jsonb_build_object('id', p_id, 'version', e.version + 1);
end $$;

create or replace function api.expense_pay(p_ctx jsonb, p_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare e finance.expenses%rowtype; v_paid bigint; v_id uuid;
begin
  perform identity.require_actor((p_ctx->>'actor_id')::uuid, 'finance.manage');
  select * into e from finance.expenses where id = p_id for update;
  if not found then perform api.fail('NOT_FOUND'); end if;
  if e.state <> 'OPEN' or e.version <> (p->>'expected_version')::int then perform api.fail('VERSION_CONFLICT'); end if;
  select coalesce(sum(amount_cents), 0) into v_paid from finance.expense_payments where expense_id = p_id and reversed_at is null;
  if v_paid + (p->>'amount_cents')::bigint > e.amount_cents then
    perform api.fail('VALIDATION_FAILED', jsonb_build_object('field', 'amount_cents', 'reason', 'exceeds_open_amount'));
  end if;
  insert into finance.expense_payments (expense_id, amount_cents, paid_on, method, note, created_by)
  values (p_id, (p->>'amount_cents')::bigint, (p->>'paid_on')::date, p->>'method', nullif(btrim(p->>'note'), ''), (p_ctx->>'actor_id')::uuid)
  returning id into v_id;
  update finance.expenses set version = version + 1 where id = p_id;
  perform audit.record(p_ctx, 'expense.paid', 'expense', p_id, jsonb_build_object('payment_id', v_id, 'amount_cents', p->>'amount_cents'));
  return jsonb_build_object('payment_id', v_id, 'version', e.version + 1);
end $$;

create or replace function api.expense_payment_reverse(p_ctx jsonb, p_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare x finance.expense_payments%rowtype;
begin
  perform identity.require_actor((p_ctx->>'actor_id')::uuid, 'finance.manage');
  select * into x from finance.expense_payments where id = p_id for update;
  if not found then perform api.fail('NOT_FOUND'); end if;
  if x.reversed_at is not null then perform api.fail('VERSION_CONFLICT', jsonb_build_object('reason', 'already_reversed')); end if;
  update finance.expense_payments set reversed_at = now(), reversed_by = (p_ctx->>'actor_id')::uuid, reversed_reason = btrim(p->>'reason') where id = p_id;
  update finance.expenses set version = version + 1 where id = x.expense_id;
  perform audit.record(p_ctx, 'expense.payment_reversed', 'expense', x.expense_id, jsonb_build_object('payment_id', p_id, 'reason', p->>'reason'));
  return jsonb_build_object('id', p_id, 'reversed', true);
end $$;

-- Resultado gerencial do mês (competência). Não é DRE contábil; impostos sobre venda só entram quando lançados.
create or replace function api.management_result(p_actor uuid, p_month date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_m date := date_trunc('month', p_month)::date; v_from timestamptz; v_to timestamptz;
        v_rev bigint; v_freight bigint; v_orders int; v_cogs bigint; v_unknown int; v_comm bigint; v_cats jsonb;
        v_opex bigint; v_tax bigint; v_fin bigint; v_non bigint; v_cash_out bigint;
begin
  perform identity.require_actor(p_actor, 'finance.manage');
  v_from := v_m::timestamp at time zone 'America/Sao_Paulo';
  v_to := (v_m + interval '1 month')::timestamp at time zone 'America/Sao_Paulo';
  select count(*), coalesce(sum(total_cents - freight_cents), 0), coalesce(sum(freight_cents), 0) into v_orders, v_rev, v_freight
    from sales.orders where commercial_state <> 'CANCELLED' and confirmed_at >= v_from and confirmed_at < v_to;
  select coalesce(sum(i.cost_snapshot_cents * i.quantity), 0), count(*) filter (where i.cost_snapshot_cents is null)
    into v_cogs, v_unknown
    from sales.order_items i join sales.orders o on o.id = i.order_id
   where o.commercial_state <> 'CANCELLED' and o.confirmed_at >= v_from and o.confirmed_at < v_to;
  select coalesce(sum(e.amount_cents), 0) into v_comm from finance.staff_commission_entries e join sales.orders o on o.id = e.order_id
   where e.state <> 'REVERSED' and o.confirmed_at >= v_from and o.confirmed_at < v_to;
  select coalesce(jsonb_agg(jsonb_build_object('category', c.name, 'kind', c.kind, 'amount_cents', s.total::text) order by c.position), '[]'::jsonb),
         coalesce(sum(s.total) filter (where c.kind = 'OPERATING'), 0), coalesce(sum(s.total) filter (where c.kind = 'TAX'), 0),
         coalesce(sum(s.total) filter (where c.kind = 'FINANCIAL'), 0), coalesce(sum(s.total) filter (where c.kind in ('NON_RESULT', 'COST_OF_GOODS')), 0)
    into v_cats, v_opex, v_tax, v_fin, v_non
    from (select category_id, sum(amount_cents) total from finance.expenses where state = 'OPEN' and competence_month = v_m group by category_id) s
    join finance.expense_categories c on c.id = s.category_id;
  select coalesce(sum(x.amount_cents), 0) into v_cash_out from finance.expense_payments x
   where x.reversed_at is null and x.paid_on >= v_m and x.paid_on < (v_m + interval '1 month')::date;
  return jsonb_build_object('month', v_m, 'orders', v_orders,
    'revenue_cents', v_rev::text, 'freight_cents', v_freight::text,
    'cogs_cents', v_cogs::text, 'cogs_unknown_items', v_unknown,
    'gross_profit_cents', (v_rev - v_cogs)::text,
    'staff_commission_cents', v_comm::text, 'taxes_cents', v_tax::text, 'operating_expenses_cents', v_opex::text,
    'financial_expenses_cents', v_fin::text,
    'result_cents', (v_rev - v_cogs - v_comm - v_tax - v_opex - v_fin)::text,
    'non_result_cents', v_non::text, 'expenses_paid_in_month_cents', v_cash_out::text,
    'by_category', v_cats,
    'completeness', case when v_unknown > 0 then 'PARTIAL' else 'COMPLETE_FOR_RECORDED_FACTS' end,
    'warnings', to_jsonb(array_remove(array[
       case when v_unknown > 0 then 'cost_unknown_for_some_items' end,
       case when v_tax = 0 and v_orders > 0 then 'no_tax_recorded' end,
       'payment_provider_fees_not_integrated'], null)));
end $$;

grant execute on all functions in schema api to ninebike_api;
revoke execute on function api.fail(text, jsonb) from ninebike_api;
revoke all on all functions in schema finance from public;
revoke all on all tables in schema finance from public;
alter table finance.expense_categories enable row level security;
alter table finance.expenses enable row level security;
alter table finance.expense_payments enable row level security;
