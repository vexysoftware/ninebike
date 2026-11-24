-- NINEBIKE OS — venda rápida de balcão e caixa do dia.
-- Venda rápida = proposta + reserva + pedido numa única transação (mesmas regras: preço do catálogo,
-- alçada de desconto, estoque sob lock, comissões). Recebimentos marcados como "recebido agora" entram no caixa.
-- Caixa do dia: abertura, entradas/saídas (vendas, suprimento, sangria, despesas), estornos com motivo e fechamento
-- com valor contado e diferença. É registro gerencial da loja; não substitui extrato bancário/maquininha.

alter table finance.payment_allocations drop constraint payment_allocations_approved_method_check;
alter table finance.payment_allocations add constraint payment_allocations_approved_method_check
  check (approved_method in ('PIX', 'BOLETO', 'CARD', 'KOIN_APP_PIX', 'CASH', 'TRANSFER'));

create table finance.cash_sessions (
  id uuid primary key default gen_random_uuid(),
  business_date date not null unique,
  opening_cents bigint not null check (opening_cents >= 0),
  opened_by uuid not null references identity.profiles(id),
  opened_at timestamptz not null default now(),
  closed_at timestamptz, closed_by uuid references identity.profiles(id),
  counted_cents bigint check (counted_cents >= 0),
  expected_cash_cents bigint,
  close_note text check (length(close_note) <= 500),
  version integer not null default 1
);

create table finance.cash_entries (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references finance.cash_sessions(id),
  direction text not null check (direction in ('IN', 'OUT')),
  kind text not null check (kind in ('SALE', 'RECEIPT', 'SUPPLY', 'WITHDRAWAL', 'EXPENSE', 'OTHER')),
  method text not null check (method in ('CASH', 'PIX', 'DEBIT', 'CREDIT', 'TRANSFER', 'BOLETO', 'OTHER')),
  installments smallint check (installments between 1 and 24),
  amount_cents bigint not null check (amount_cents > 0),
  description text not null check (length(description) between 1 and 200),
  order_id uuid references sales.orders(id),
  created_by uuid not null references identity.profiles(id),
  created_at timestamptz not null default now(),
  reversed_at timestamptz, reversed_by uuid references identity.profiles(id), reversed_reason text
);
create index cash_entries_session on finance.cash_entries (session_id, created_at);
create index cash_entries_order on finance.cash_entries (order_id) where order_id is not null;

create or replace function finance.today_sp() returns date language sql stable as $$
  select (now() at time zone 'America/Sao_Paulo')::date
$$;

-- Sessão aberta do dia; abre com saldo zero se ninguém abriu (a venda nunca fica sem caixa).
create or replace function finance.cash_session_for_today(p_actor uuid) returns finance.cash_sessions
language plpgsql security definer set search_path = '' as $$
declare s finance.cash_sessions%rowtype;
begin
  insert into finance.cash_sessions (business_date, opening_cents, opened_by) values (finance.today_sp(), 0, p_actor)
  on conflict (business_date) do nothing;
  select * into s from finance.cash_sessions where business_date = finance.today_sp() for update;
  if s.closed_at is not null then perform api.fail('VERSION_CONFLICT', jsonb_build_object('reason', 'cash_closed')); end if;
  return s;
end $$;

create or replace function finance.add_cash_entry(p_actor uuid, p_dir text, p_kind text, p_method text, p_amount bigint,
  p_desc text, p_order uuid, p_inst smallint default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare s finance.cash_sessions%rowtype; v_id uuid;
begin
  s := finance.cash_session_for_today(p_actor);
  insert into finance.cash_entries (session_id, direction, kind, method, installments, amount_cents, description, order_id, created_by)
  values (s.id, p_dir, p_kind, p_method, p_inst, p_amount, left(p_desc, 200), p_order, p_actor) returning id into v_id;
  return v_id;
end $$;

-- ============================================================ venda rápida
create or replace function api.quick_sale(p_ctx jsonb, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (p_ctx->>'actor_id')::uuid; v_q jsonb; v_o jsonb; v_allocs jsonb := '[]'::jsonb; x jsonb;
        v_total bigint; v_sum bigint := 0; v_received bigint := 0;
begin
  perform identity.require_actor(v_actor, 'crm.write');
  v_q := api.quote_create(p_ctx, jsonb_build_object('contact_id', p->'contact_id', 'items', p->'items', 'freight_cents', coalesce(p->'freight_cents', '"0"')));
  select total_cents into v_total from sales.quotes where id = (v_q->>'id')::uuid;
  for x in select * from jsonb_array_elements(p->'payments') loop
    v_sum := v_sum + (x->>'amount_cents')::bigint;
    v_allocs := v_allocs || jsonb_build_object(
      'mode', case x->>'method' when 'DEBIT' then 'CARD' when 'CREDIT' then 'CARD' else x->>'method' end,
      'principal_cents', x->>'amount_cents', 'due_date', coalesce(x->>'due_date', finance.today_sp()::text),
      'installment_count', case x->>'method' when 'CREDIT' then coalesce((x->>'installments')::int, 1) when 'DEBIT' then 1 end);
  end loop;
  if v_sum <> v_total then
    perform api.fail('VALIDATION_FAILED', jsonb_build_object('field', 'payments', 'reason', 'sum_must_equal_total', 'total_cents', v_total::text, 'sum_cents', v_sum::text));
  end if;
  perform api.reservation_create(p_ctx, jsonb_build_object('quote_id', v_q->>'id', 'quote_version', 1));
  v_o := api.order_confirm(p_ctx, jsonb_build_object('quote_id', v_q->>'id', 'quote_version', 1, 'allocations', v_allocs));
  for x in select * from jsonb_array_elements(p->'payments') loop
    if coalesce((x->>'received')::boolean, false) then
      perform finance.add_cash_entry(v_actor, 'IN', 'SALE', x->>'method', (x->>'amount_cents')::bigint,
        format('Venda #%s', v_o->>'display_number'), (v_o->>'id')::uuid, (x->>'installments')::smallint);
      v_received := v_received + (x->>'amount_cents')::bigint;
    end if;
  end loop;
  return v_o || jsonb_build_object('total_cents', v_total::text, 'received_cents', v_received::text);
end $$;

-- Recebimento posterior de um pedido (ex.: sinal hoje, restante na entrega).
create or replace function api.order_receive(p_ctx jsonb, p_order uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (p_ctx->>'actor_id')::uuid; v_role text; o sales.orders%rowtype; v_rec bigint; v_id uuid;
begin
  v_role := identity.require_actor(v_actor, 'crm.write');
  select * into o from sales.orders where id = p_order for update;
  if not found or (v_role <> 'OWNER' and o.owner_id <> v_actor) then perform api.fail('NOT_FOUND'); end if;
  if o.commercial_state = 'CANCELLED' then perform api.fail('VERSION_CONFLICT', jsonb_build_object('reason', 'order_cancelled')); end if;
  select coalesce(sum(amount_cents), 0) into v_rec from finance.cash_entries where order_id = p_order and direction = 'IN' and reversed_at is null;
  if v_rec + (p->>'amount_cents')::bigint > o.total_cents then
    perform api.fail('VALIDATION_FAILED', jsonb_build_object('field', 'amount_cents', 'reason', 'exceeds_order_balance', 'open_cents', (o.total_cents - v_rec)::text));
  end if;
  v_id := finance.add_cash_entry(v_actor, 'IN', 'RECEIPT', p->>'method', (p->>'amount_cents')::bigint,
    coalesce(nullif(btrim(p->>'description'), ''), format('Recebimento pedido #%s', o.display_number)), p_order, (p->>'installments')::smallint);
  perform audit.record(p_ctx, 'order.received', 'order', p_order, jsonb_build_object('entry_id', v_id, 'amount_cents', p->>'amount_cents', 'method', p->>'method'));
  return jsonb_build_object('entry_id', v_id, 'received_cents', (v_rec + (p->>'amount_cents')::bigint)::text, 'open_cents', (o.total_cents - v_rec - (p->>'amount_cents')::bigint)::text);
end $$;

create or replace function api.order_receipts(p_actor uuid, p_order uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_role text := identity.require_actor(p_actor, 'crm.read'); o sales.orders%rowtype;
begin
  select * into o from sales.orders where id = p_order;
  if not found or (v_role <> 'OWNER' and o.owner_id <> p_actor) then perform api.fail('NOT_FOUND'); end if;
  return jsonb_build_object('total_cents', o.total_cents::text,
    'received_cents', (select coalesce(sum(amount_cents), 0) from finance.cash_entries where order_id = p_order and direction = 'IN' and reversed_at is null)::text,
    'entries', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'method', e.method, 'installments', e.installments,
        'amount_cents', e.amount_cents::text, 'created_at', e.created_at, 'by', pr.name, 'reversed_at', e.reversed_at) order by e.created_at)
      from finance.cash_entries e join identity.profiles pr on pr.id = e.created_by where e.order_id = p_order), '[]'::jsonb));
end $$;

-- ============================================================ caixa
create or replace function api.cash_day(p_actor uuid, p_date date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_role text := identity.require_actor(p_actor, 'crm.read'); s finance.cash_sessions%rowtype; v_d date := coalesce(p_date, finance.today_sp());
begin
  if v_role <> 'OWNER' and v_d <> finance.today_sp() then perform api.fail('PERMISSION_DENIED', jsonb_build_object('reason', 'only_today')); end if;
  select * into s from finance.cash_sessions where business_date = v_d;
  if not found then return jsonb_build_object('business_date', v_d, 'session', null, 'entries', '[]'::jsonb, 'by_method', '[]'::jsonb); end if;
  return jsonb_build_object('business_date', v_d,
    'session', jsonb_build_object('id', s.id, 'opening_cents', s.opening_cents::text, 'opened_at', s.opened_at,
      'opened_by', (select name from identity.profiles where id = s.opened_by), 'closed_at', s.closed_at,
      'closed_by', (select name from identity.profiles where id = s.closed_by), 'counted_cents', s.counted_cents::text,
      'expected_cash_cents', s.expected_cash_cents::text, 'close_note', s.close_note, 'version', s.version),
    'entries', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'direction', e.direction, 'kind', e.kind, 'method', e.method,
        'installments', e.installments, 'amount_cents', e.amount_cents::text, 'description', e.description, 'order_id', e.order_id,
        'by', pr.name, 'created_at', e.created_at, 'reversed_at', e.reversed_at, 'reversed_reason', e.reversed_reason) order by e.created_at desc)
      from finance.cash_entries e join identity.profiles pr on pr.id = e.created_by where e.session_id = s.id), '[]'::jsonb),
    'by_method', coalesce((select jsonb_agg(jsonb_build_object('method', m, 'in_cents', i::text, 'out_cents', o::text) order by m)
      from (select method m, coalesce(sum(amount_cents) filter (where direction = 'IN'), 0) i, coalesce(sum(amount_cents) filter (where direction = 'OUT'), 0) o
              from finance.cash_entries where session_id = s.id and reversed_at is null group by method) t), '[]'::jsonb),
    'expected_cash_now_cents', (s.opening_cents + (select coalesce(sum(case direction when 'IN' then amount_cents else -amount_cents end), 0)
      from finance.cash_entries where session_id = s.id and method = 'CASH' and reversed_at is null))::text);
end $$;

create or replace function api.cash_open(p_ctx jsonb, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (p_ctx->>'actor_id')::uuid; s finance.cash_sessions%rowtype;
begin
  perform identity.require_actor(v_actor, 'crm.write');
  select * into s from finance.cash_sessions where business_date = finance.today_sp() for update;
  if found then
    -- Ajusta o troco inicial só enquanto não houver lançamento em dinheiro.
    if s.closed_at is not null or exists (select 1 from finance.cash_entries where session_id = s.id) then
      perform api.fail('VERSION_CONFLICT', jsonb_build_object('reason', 'cash_already_in_use'));
    end if;
    update finance.cash_sessions set opening_cents = (p->>'opening_cents')::bigint, opened_by = v_actor, opened_at = now(), version = version + 1 where id = s.id;
  else
    insert into finance.cash_sessions (business_date, opening_cents, opened_by) values (finance.today_sp(), (p->>'opening_cents')::bigint, v_actor);
  end if;
  perform audit.record(p_ctx, 'cash.opened', 'cash_session', null, p);
  return jsonb_build_object('business_date', finance.today_sp());
end $$;

create or replace function api.cash_entry_create(p_ctx jsonb, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (p_ctx->>'actor_id')::uuid; v_id uuid;
begin
  perform identity.require_actor(v_actor, 'crm.write');
  v_id := finance.add_cash_entry(v_actor, p->>'direction', p->>'kind', p->>'method', (p->>'amount_cents')::bigint, btrim(p->>'description'), null);
  perform audit.record(p_ctx, 'cash.entry', 'cash_entry', v_id, p);
  return jsonb_build_object('id', v_id);
end $$;

create or replace function api.cash_entry_reverse(p_ctx jsonb, p_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (p_ctx->>'actor_id')::uuid; v_role text; e finance.cash_entries%rowtype; s finance.cash_sessions%rowtype;
begin
  v_role := identity.require_actor(v_actor, 'crm.write');
  select * into e from finance.cash_entries where id = p_id for update;
  if not found then perform api.fail('NOT_FOUND'); end if;
  select * into s from finance.cash_sessions where id = e.session_id;
  if s.closed_at is not null then perform api.fail('VERSION_CONFLICT', jsonb_build_object('reason', 'cash_closed')); end if;
  if e.reversed_at is not null then perform api.fail('VERSION_CONFLICT', jsonb_build_object('reason', 'already_reversed')); end if;
  if v_role <> 'OWNER' and e.created_by <> v_actor then perform api.fail('PERMISSION_DENIED'); end if;
  update finance.cash_entries set reversed_at = now(), reversed_by = v_actor, reversed_reason = btrim(p->>'reason') where id = p_id;
  perform audit.record(p_ctx, 'cash.entry_reversed', 'cash_entry', p_id, p);
  return jsonb_build_object('id', p_id, 'reversed', true);
end $$;

create or replace function api.cash_close(p_ctx jsonb, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (p_ctx->>'actor_id')::uuid; s finance.cash_sessions%rowtype; v_exp bigint;
begin
  perform identity.require_actor(v_actor, 'crm.write');
  select * into s from finance.cash_sessions where business_date = finance.today_sp() for update;
  if not found or s.closed_at is not null then perform api.fail('VERSION_CONFLICT', jsonb_build_object('reason', 'no_open_cash')); end if;
  select s.opening_cents + coalesce(sum(case direction when 'IN' then amount_cents else -amount_cents end), 0) into v_exp
    from finance.cash_entries where session_id = s.id and method = 'CASH' and reversed_at is null;
  update finance.cash_sessions set closed_at = now(), closed_by = v_actor, counted_cents = (p->>'counted_cents')::bigint,
         expected_cash_cents = v_exp, close_note = nullif(btrim(p->>'note'), ''), version = version + 1 where id = s.id;
  perform audit.record(p_ctx, 'cash.closed', 'cash_session', s.id, jsonb_build_object('counted_cents', p->>'counted_cents', 'expected_cents', v_exp::text));
  return jsonb_build_object('expected_cash_cents', v_exp::text, 'counted_cents', p->>'counted_cents',
    'difference_cents', ((p->>'counted_cents')::bigint - v_exp)::text);
end $$;

create or replace function api.cash_reopen(p_ctx jsonb, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform identity.require_actor((p_ctx->>'actor_id')::uuid, 'finance.manage');
  update finance.cash_sessions set closed_at = null, closed_by = null, version = version + 1
   where business_date = finance.today_sp() and closed_at is not null;
  if not found then perform api.fail('NOT_FOUND'); end if;
  perform audit.record(p_ctx, 'cash.reopened', 'cash_session', null, p);
  return jsonb_build_object('reopened', true);
end $$;

grant execute on all functions in schema api to ninebike_api;
revoke execute on function api.fail(text, jsonb) from ninebike_api;
revoke all on all functions in schema finance from public;
alter table finance.cash_sessions enable row level security;
alter table finance.cash_entries enable row level security;
