-- NINEBIKE OS — IA com autonomia operacional: visitas, cobranças (Pix/link) e atribuição de vendas à IA.
--
-- Decisão do responsável (25/11/2026): a IA do WhatsApp registra visitas agendadas e cobranças geradas/pagas,
-- e as vendas de clientes trazidos por ela formam a base de comissão da operadora da IA.
-- Limites mantidos: a IA age só pelas rotas /agent/v1 com escopo; não aprova nota, não cancela venda,
-- não altera preço/estoque/usuários e não apaga nada. Tudo fica auditado com o id da chave.
-- Pagamento informado pela IA/n8n é "INFORMADO"; a confirmação do proprietário (ou do provedor no futuro)
-- é separada — o relatório mostra as duas colunas.

alter table integrations.agent_clients drop constraint agent_clients_scopes_check;
alter table integrations.agent_clients add constraint agent_clients_scopes_check check (
  scopes <@ array['catalog.read','customers.read','leads.write','visits.write','payments.write']::text[] and cardinality(scopes) > 0);

-- ============================================================ atribuição à IA
create table integrations.ai_attributions (
  contact_id uuid primary key references crm.contacts(id),
  client_id uuid references integrations.agent_clients(id),
  first_reason text not null check (first_reason in ('LEAD', 'VISIT', 'PAYMENT', 'MANUAL')),
  attributed_at timestamptz not null default now(),
  removed_at timestamptz, removed_by uuid references identity.profiles(id), removed_reason text
);

create or replace function integrations.attribute(p_contact uuid, p_client uuid, p_reason text) returns void
language sql security definer set search_path = '' as $$
  insert into integrations.ai_attributions (contact_id, client_id, first_reason) values (p_contact, p_client, p_reason)
  on conflict (contact_id) do nothing
$$;

-- Lead criado pela IA: o contato passa a ser atribuído (só quando o contato é novo).
create or replace function integrations.on_agent_lead() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.created_contact then perform integrations.attribute(new.contact_id, new.client_id, 'LEAD'); end if;
  return new;
end $$;
create trigger agent_lead_attribution after insert on integrations.agent_lead_events for each row execute function integrations.on_agent_lead();
insert into integrations.ai_attributions (contact_id, client_id, first_reason, attributed_at)
select contact_id, client_id, 'LEAD', received_at from integrations.agent_lead_events where created_contact
on conflict do nothing;

-- ============================================================ visitas
create table crm.visits (
  id uuid primary key default gen_random_uuid(),
  event_id uuid unique,
  request_hash text,
  contact_id uuid not null references crm.contacts(id),
  opportunity_id uuid references crm.opportunities(id),
  scheduled_at timestamptz not null,
  state text not null default 'SCHEDULED' check (state in ('SCHEDULED', 'ATTENDED', 'NO_SHOW', 'CANCELLED')),
  source text not null check (source in ('whatsapp_ai', 'human')),
  agent_client_id uuid references integrations.agent_clients(id),
  created_by uuid references identity.profiles(id),
  note text check (length(note) <= 1000),
  interest_product_id uuid references inventory.products(id),
  state_changed_at timestamptz, state_changed_by uuid references identity.profiles(id),
  version integer not null default 1,
  created_at timestamptz not null default now()
);
create index visits_when on crm.visits (scheduled_at);

create or replace function crm.visit_json(v crm.visits) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', v.id, 'contact_id', v.contact_id, 'contact_name', c.name, 'mobile_phone', c.mobile_e164,
    'opportunity_id', v.opportunity_id, 'scheduled_at', v.scheduled_at, 'state', v.state, 'source', v.source, 'note', v.note,
    'interest_product', (select name from inventory.products where id = v.interest_product_id),
    'seller_name', (select name from identity.profiles where id = c.owner_id), 'version', v.version, 'created_at', v.created_at)
  from crm.contacts c where c.id = v.contact_id
$$;

-- Contato pelo celular; cria (atribuído à IA) se não existir. Usado por visita e cobrança.
create or replace function integrations.agent_contact(p_client uuid, p_mobile text, p_name text, p_reason text) returns crm.contacts
language plpgsql security definer set search_path = '' as $$
declare c crm.contacts%rowtype; v_owner uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('agent-lead:' || p_mobile, 0));
  select * into c from crm.contacts where mobile_e164 = p_mobile order by created_at limit 1;
  if found then
    -- Cliente já existente só é atribuído se ainda não tem venda anterior (evita reivindicar cliente antigo da loja).
    if not exists (select 1 from sales.orders o where o.contact_id = c.id and o.commercial_state <> 'CANCELLED') then
      perform integrations.attribute(c.id, p_client, p_reason);
    end if;
    return c;
  end if;
  if nullif(btrim(p_name), '') is null then perform api.fail('VALIDATION_FAILED', jsonb_build_object('field', 'name', 'reason', 'required_for_new_contact')); end if;
  select default_lead_owner_id into v_owner from crm.settings s
   where exists (select 1 from identity.profiles pr where pr.id = s.default_lead_owner_id and pr.active);
  if v_owner is null then perform api.fail('CAPABILITY_UNAVAILABLE', jsonb_build_object('reason', 'lead_owner_not_configured')); end if;
  insert into crm.contacts (name, mobile_e164, owner_id) values (btrim(p_name), p_mobile, v_owner) returning * into c;
  perform crm.require_customer_fields(c);
  insert into crm.contact_roles (contact_id, role) values (c.id, 'CUSTOMER');
  perform integrations.attribute(c.id, p_client, p_reason);
  return c;
end $$;

create or replace function api.agent_visit_create(p_token_hash text, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_client uuid; c crm.contacts%rowtype; v crm.visits%rowtype; v_opp uuid;
begin
  v_client := integrations.agent_require(p_token_hash, 'visits.write', 'visits.create');
  select * into v from crm.visits where event_id = (p->>'event_id')::uuid;
  if found then
    if v.request_hash <> p->>'request_hash' then perform api.fail('IDEMPOTENCY_CONFLICT'); end if;
    return crm.visit_json(v) || jsonb_build_object('replayed', true);
  end if;
  if (p->>'scheduled_at')::timestamptz < now() - interval '1 day' then
    perform api.fail('VALIDATION_FAILED', jsonb_build_object('field', 'scheduled_at', 'reason', 'in_the_past'));
  end if;
  c := integrations.agent_contact(v_client, p->>'mobile_e164', p->>'name', 'VISIT');
  select o.id into v_opp from crm.opportunities o join crm.pipeline_stages s on s.id = o.stage_id
   where o.contact_id = c.id and s.kind = 'OPEN' order by o.updated_at desc limit 1;
  insert into crm.visits (event_id, request_hash, contact_id, opportunity_id, scheduled_at, source, agent_client_id, note, interest_product_id)
  values ((p->>'event_id')::uuid, p->>'request_hash', c.id, v_opp, (p->>'scheduled_at')::timestamptz, 'whatsapp_ai', v_client,
          nullif(btrim(p->>'note'), ''), (select id from inventory.products where id = nullif(p->>'interest_product_id', '')::uuid))
  returning * into v;
  insert into crm.activities (contact_id, opportunity_id, author_id, kind, body, due_at)
  values (c.id, v_opp, c.owner_id, 'TASK', format('Visita agendada pela IA%s', coalesce(': ' || nullif(btrim(p->>'note'), ''), '')), v.scheduled_at);
  insert into audit.audit_events (actor_kind, action, resource_type, resource_id, decision, before_after)
  values ('SYSTEM', 'agent.visit_created', 'visit', v.id, 'ALLOW', jsonb_build_object('client_id', v_client));
  perform integrations.enqueue('visit.scheduled', crm.visit_json(v));
  return crm.visit_json(v) || jsonb_build_object('replayed', false);
end $$;

-- A IA pode remarcar ou cancelar visita que ela mesma marcou; comparecimento é registrado na loja (humano).
create or replace function api.agent_visit_update(p_token_hash text, p_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_client uuid; v crm.visits%rowtype;
begin
  v_client := integrations.agent_require(p_token_hash, 'visits.write', 'visits.update');
  select * into v from crm.visits where id = p_id for update;
  if not found or v.source <> 'whatsapp_ai' then perform api.fail('NOT_FOUND'); end if;
  if v.state <> 'SCHEDULED' then perform api.fail('VERSION_CONFLICT', jsonb_build_object('reason', 'visit_not_scheduled')); end if;
  update crm.visits set scheduled_at = coalesce((p->>'scheduled_at')::timestamptz, scheduled_at),
         state = case when p->>'state' = 'CANCELLED' then 'CANCELLED' else state end,
         note = coalesce(nullif(btrim(p->>'note'), ''), note), version = version + 1, state_changed_at = now()
   where id = p_id returning * into v;
  insert into audit.audit_events (actor_kind, action, resource_type, resource_id, decision, before_after)
  values ('SYSTEM', 'agent.visit_updated', 'visit', p_id, 'ALLOW', jsonb_build_object('client_id', v_client, 'change', p - 'request_hash'));
  return crm.visit_json(v);
end $$;

create or replace function api.visit_list(p_actor uuid, p jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_role text := identity.require_actor(p_actor, 'crm.read');
begin
  return coalesce((select jsonb_agg(crm.visit_json(v) order by v.scheduled_at) from crm.visits v join crm.contacts c on c.id = v.contact_id
    where (v_role = 'OWNER' or c.owner_id = p_actor)
      and v.scheduled_at >= coalesce((p->>'from')::timestamptz, now() - interval '1 day')
      and v.scheduled_at < coalesce((p->>'to')::timestamptz, now() + interval '30 days')
      and (p->>'state' is null or v.state = p->>'state')), '[]'::jsonb);
end $$;

create or replace function api.visit_set_state(p_ctx jsonb, p_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (p_ctx->>'actor_id')::uuid; v_role text; v crm.visits%rowtype;
begin
  v_role := identity.require_actor(v_actor, 'crm.write');
  select v2.* into v from crm.visits v2 join crm.contacts c on c.id = v2.contact_id
   where v2.id = p_id and (v_role = 'OWNER' or c.owner_id = v_actor) for update of v2;
  if not found then perform api.fail('NOT_FOUND'); end if;
  if v.version <> (p->>'expected_version')::int then perform api.fail('VERSION_CONFLICT'); end if;
  update crm.visits set state = p->>'state', state_changed_at = now(), state_changed_by = v_actor, version = version + 1 where id = p_id returning * into v;
  perform audit.record(p_ctx, 'visit.state_changed', 'visit', p_id, jsonb_build_object('state', p->>'state'));
  return crm.visit_json(v);
end $$;

-- ============================================================ cobranças geradas pela IA (Pix / link)
create table finance.ai_charges (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null unique,
  request_hash text not null,
  agent_client_id uuid not null references integrations.agent_clients(id),
  contact_id uuid not null references crm.contacts(id),
  kind text not null check (kind in ('PIX', 'LINK')),
  provider text not null check (length(provider) between 1 and 40),
  external_id text check (length(external_id) <= 120),
  amount_cents bigint not null check (amount_cents > 0),
  description text not null check (length(description) between 1 and 300),
  url text check (url ~ '^https://' and length(url) <= 1000),
  product_id uuid references inventory.products(id),
  state text not null default 'CREATED' check (state in ('CREATED', 'PAID_REPORTED', 'EXPIRED', 'CANCELLED')),
  paid_reported_at timestamptz, paid_amount_cents bigint check (paid_amount_cents > 0),
  confirmation text not null default 'PENDING' check (confirmation in ('PENDING', 'CONFIRMED', 'REJECTED')),
  confirmed_by uuid references identity.profiles(id), confirmed_at timestamptz, confirmation_note text,
  order_id uuid references sales.orders(id),
  created_at timestamptz not null default now(),
  version integer not null default 1
);
create unique index ai_charges_external on finance.ai_charges (provider, external_id) where external_id is not null;

create or replace function finance.ai_charge_json(x finance.ai_charges) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', x.id, 'contact_id', x.contact_id, 'contact_name', c.name, 'mobile_phone', c.mobile_e164,
    'kind', x.kind, 'provider', x.provider, 'external_id', x.external_id, 'amount_cents', x.amount_cents::text,
    'description', x.description, 'url', x.url, 'product', (select name from inventory.products where id = x.product_id),
    'state', x.state, 'paid_reported_at', x.paid_reported_at, 'paid_amount_cents', x.paid_amount_cents::text,
    'confirmation', x.confirmation, 'confirmed_at', x.confirmed_at, 'confirmation_note', x.confirmation_note,
    'order_id', x.order_id, 'order_number', (select display_number from sales.orders where id = x.order_id),
    'created_at', x.created_at, 'version', x.version)
  from crm.contacts c where c.id = x.contact_id
$$;

create or replace function api.agent_charge_create(p_token_hash text, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_client uuid; c crm.contacts%rowtype; x finance.ai_charges%rowtype;
begin
  v_client := integrations.agent_require(p_token_hash, 'payments.write', 'charges.create');
  select * into x from finance.ai_charges where event_id = (p->>'event_id')::uuid;
  if found then
    if x.request_hash <> p->>'request_hash' then perform api.fail('IDEMPOTENCY_CONFLICT'); end if;
    return finance.ai_charge_json(x) || jsonb_build_object('replayed', true);
  end if;
  c := integrations.agent_contact(v_client, p->>'mobile_e164', p->>'name', 'PAYMENT');
  insert into finance.ai_charges (event_id, request_hash, agent_client_id, contact_id, kind, provider, external_id, amount_cents, description, url, product_id)
  values ((p->>'event_id')::uuid, p->>'request_hash', v_client, c.id, p->>'kind', p->>'provider', nullif(p->>'external_id', ''),
          (p->>'amount_cents')::bigint, btrim(p->>'description'), nullif(p->>'url', ''),
          (select id from inventory.products where id = nullif(p->>'product_id', '')::uuid))
  returning * into x;
  insert into crm.activities (contact_id, author_id, kind, body)
  values (c.id, c.owner_id, 'NOTE', format('[IA WhatsApp] %s gerado: %s — R$ %s', case x.kind when 'PIX' then 'Pix' else 'Link de pagamento' end,
          x.description, to_char(x.amount_cents / 100.0, 'FM999G999G990D00')));
  insert into audit.audit_events (actor_kind, action, resource_type, resource_id, decision, before_after)
  values ('SYSTEM', 'agent.charge_created', 'ai_charge', x.id, 'ALLOW', jsonb_build_object('client_id', v_client, 'amount_cents', x.amount_cents::text));
  return finance.ai_charge_json(x) || jsonb_build_object('replayed', false);
end $$;

-- Atualização pela IA/n8n: pago (informado), expirado ou cancelado. Localiza por id ou (provider, external_id).
create or replace function api.agent_charge_update(p_token_hash text, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_client uuid; x finance.ai_charges%rowtype;
begin
  v_client := integrations.agent_require(p_token_hash, 'payments.write', 'charges.update');
  select * into x from finance.ai_charges
   where (p->>'id' is not null and id = (p->>'id')::uuid)
      or (p->>'id' is null and provider = p->>'provider' and external_id = p->>'external_id')
   for update;
  if not found then perform api.fail('NOT_FOUND'); end if;
  if x.state = p->>'state' then return finance.ai_charge_json(x) || jsonb_build_object('replayed', true); end if;
  if x.state <> 'CREATED' or x.confirmation <> 'PENDING' then perform api.fail('VERSION_CONFLICT', jsonb_build_object('reason', 'charge_not_open')); end if;
  update finance.ai_charges set state = p->>'state',
         paid_reported_at = case when p->>'state' = 'PAID_REPORTED' then coalesce((p->>'paid_at')::timestamptz, now()) end,
         paid_amount_cents = case when p->>'state' = 'PAID_REPORTED' then coalesce((p->>'paid_amount_cents')::bigint, amount_cents) end,
         version = version + 1
   where id = x.id returning * into x;
  insert into audit.audit_events (actor_kind, action, resource_type, resource_id, decision, before_after)
  values ('SYSTEM', 'agent.charge_updated', 'ai_charge', x.id, 'ALLOW', jsonb_build_object('client_id', v_client, 'state', x.state));
  if x.state = 'PAID_REPORTED' then
    insert into crm.activities (contact_id, author_id, kind, body)
    select x.contact_id, c.owner_id, 'TASK', format('Pagamento informado pela IA (%s, R$ %s). Conferir no banco/maquininha e registrar a venda.',
           x.description, to_char(x.paid_amount_cents / 100.0, 'FM999G999G990D00')) from crm.contacts c where c.id = x.contact_id;
    perform integrations.enqueue('charge.paid_reported', finance.ai_charge_json(x));
  end if;
  return finance.ai_charge_json(x) || jsonb_build_object('replayed', false);
end $$;

-- Proprietário confere no extrato: CONFIRMED / REJECTED; opcionalmente vincula ao pedido registrado.
create or replace function api.ai_charge_review(p_ctx jsonb, p_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare x finance.ai_charges%rowtype;
begin
  perform identity.require_actor((p_ctx->>'actor_id')::uuid, 'finance.manage');
  select * into x from finance.ai_charges where id = p_id for update;
  if not found then perform api.fail('NOT_FOUND'); end if;
  if x.version <> (p->>'expected_version')::int then perform api.fail('VERSION_CONFLICT'); end if;
  if p->>'order_id' is not null and not exists (select 1 from sales.orders where id = (p->>'order_id')::uuid and contact_id = x.contact_id) then
    perform api.fail('VALIDATION_FAILED', jsonb_build_object('field', 'order_id', 'reason', 'order_of_other_customer'));
  end if;
  update finance.ai_charges set confirmation = p->>'confirmation', confirmed_by = (p_ctx->>'actor_id')::uuid, confirmed_at = now(),
         confirmation_note = nullif(btrim(p->>'note'), ''), order_id = coalesce((p->>'order_id')::uuid, order_id), version = version + 1
   where id = p_id returning * into x;
  perform audit.record(p_ctx, 'ai_charge.reviewed', 'ai_charge', p_id, p);
  return finance.ai_charge_json(x);
end $$;

create or replace function api.ai_charge_list(p_actor uuid, p jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_role text := identity.require_actor(p_actor, 'crm.read');
begin
  return coalesce((select jsonb_agg(finance.ai_charge_json(x) order by x.created_at desc) from finance.ai_charges x join crm.contacts c on c.id = x.contact_id
    where (v_role = 'OWNER' or c.owner_id = p_actor) and x.created_at >= coalesce((p->>'from')::timestamptz, '-infinity')
      and x.created_at < coalesce((p->>'to')::timestamptz, 'infinity')), '[]'::jsonb);
end $$;

-- A IA consulta suas cobranças de um cliente (para não gerar duplicada).
create or replace function api.agent_charge_list(p_token_hash text, p_mobile text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform integrations.agent_require(p_token_hash, 'payments.write', 'charges.list');
  return coalesce((select jsonb_agg(finance.ai_charge_json(x) order by x.created_at desc) from finance.ai_charges x
    join crm.contacts c on c.id = x.contact_id where c.mobile_e164 = p_mobile and x.created_at > now() - interval '90 days'), '[]'::jsonb);
end $$;

-- ============================================================ comissão da operadora da IA
create table finance.ai_commission_rules (
  id uuid primary key default gen_random_uuid(),
  version integer not null unique,
  bps integer not null check (bps between 0 and 5000),
  window_days integer not null check (window_days between 1 and 730),
  created_by uuid not null references identity.profiles(id),
  created_at timestamptz not null default now()
);

create or replace function api.ai_commission_rule_create(p_ctx jsonb, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_ver int;
begin
  perform identity.require_actor((p_ctx->>'actor_id')::uuid, 'finance.manage');
  if not coalesce((p_ctx->>'mfa_recent')::boolean, false) then perform api.fail('MFA_RECENCY_REQUIRED'); end if;
  perform pg_advisory_xact_lock(hashtextextended('ai-commission-rule', 0));
  select coalesce(max(version), 0) + 1 into v_ver from finance.ai_commission_rules;
  if (p->>'expected_version')::int is distinct from v_ver - 1 then perform api.fail('VERSION_CONFLICT'); end if;
  insert into finance.ai_commission_rules (version, bps, window_days, created_by)
  values (v_ver, (p->>'bps')::int, (p->>'window_days')::int, (p_ctx->>'actor_id')::uuid);
  perform audit.record(p_ctx, 'ai_commission_rule.created', 'ai_commission_rule', null, p);
  return jsonb_build_object('version', v_ver);
end $$;

-- Relatório: vendas de clientes atribuídos à IA dentro da janela + cobranças pagas sem pedido vinculado.
create or replace function api.ai_report(p_actor uuid, p jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare r finance.ai_commission_rules%rowtype; v_from timestamptz := coalesce((p->>'from')::timestamptz, '-infinity');
        v_to timestamptz := coalesce((p->>'to')::timestamptz, 'infinity'); v_orders jsonb; v_charges jsonb;
        v_base_orders bigint; v_base_conf bigint; v_base_rep bigint;
begin
  perform identity.require_actor(p_actor, 'finance.manage');
  select * into r from finance.ai_commission_rules order by version desc limit 1;
  select coalesce(jsonb_agg(jsonb_build_object('order_id', o.id, 'number', o.display_number, 'confirmed_at', o.confirmed_at,
           'customer_name', o.customer_snapshot->>'name', 'contact_id', o.contact_id, 'total_cents', o.total_cents::text,
           'base_cents', (o.total_cents - o.freight_cents)::text, 'reason', a.first_reason, 'attributed_at', a.attributed_at,
           'seller_name', o.seller_snapshot->>'name') order by o.confirmed_at desc), '[]'::jsonb),
         coalesce(sum(o.total_cents - o.freight_cents), 0)
    into v_orders, v_base_orders
    from sales.orders o join integrations.ai_attributions a on a.contact_id = o.contact_id and a.removed_at is null
   where o.commercial_state <> 'CANCELLED' and o.confirmed_at >= v_from and o.confirmed_at < v_to
     and o.confirmed_at >= a.attributed_at - interval '1 day'
     and o.confirmed_at < a.attributed_at + make_interval(days => coalesce(r.window_days, 90));
  select coalesce(jsonb_agg(finance.ai_charge_json(x) order by x.paid_reported_at desc), '[]'::jsonb),
         coalesce(sum(x.paid_amount_cents) filter (where x.confirmation = 'CONFIRMED'), 0),
         coalesce(sum(x.paid_amount_cents) filter (where x.confirmation = 'PENDING'), 0)
    into v_charges, v_base_conf, v_base_rep
    from finance.ai_charges x where x.state = 'PAID_REPORTED' and x.order_id is null and x.confirmation <> 'REJECTED'
     and x.paid_reported_at >= v_from and x.paid_reported_at < v_to;
  return jsonb_build_object(
    'rule', case when r.id is null then null else jsonb_build_object('version', r.version, 'bps', r.bps, 'window_days', r.window_days) end,
    'customers_attributed', (select count(*) from integrations.ai_attributions where removed_at is null and attributed_at >= v_from and attributed_at < v_to),
    'leads', (select count(*) from integrations.agent_lead_events where created_contact and received_at >= v_from and received_at < v_to),
    'visits', (select jsonb_build_object('scheduled', count(*), 'attended', count(*) filter (where state = 'ATTENDED'),
                 'no_show', count(*) filter (where state = 'NO_SHOW')) from crm.visits where source = 'whatsapp_ai' and created_at >= v_from and created_at < v_to),
    'charges_created', (select count(*) from finance.ai_charges where created_at >= v_from and created_at < v_to),
    'orders', v_orders, 'paid_charges_without_order', v_charges,
    'base_orders_cents', v_base_orders::text, 'base_charges_confirmed_cents', v_base_conf::text, 'base_charges_pending_cents', v_base_rep::text,
    'commission_confirmed_cents', case when r.id is null then null else (((v_base_orders + v_base_conf) * r.bps + 5000) / 10000)::text end,
    'commission_pending_cents', case when r.id is null then null else ((v_base_rep * r.bps + 5000) / 10000)::text end);
end $$;

create or replace function api.ai_attribution_remove(p_ctx jsonb, p_contact uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform identity.require_actor((p_ctx->>'actor_id')::uuid, 'finance.manage');
  update integrations.ai_attributions set removed_at = now(), removed_by = (p_ctx->>'actor_id')::uuid, removed_reason = btrim(p->>'reason')
   where contact_id = p_contact and removed_at is null;
  if not found then perform api.fail('NOT_FOUND'); end if;
  perform audit.record(p_ctx, 'ai_attribution.removed', 'contact', p_contact, p);
  return jsonb_build_object('contact_id', p_contact, 'removed', true);
end $$;

-- Novos eventos de webhook.
alter table integrations.webhook_endpoints drop constraint webhook_endpoints_events_check;
alter table integrations.webhook_endpoints add constraint webhook_endpoints_events_check check (
  events <@ array['lead.created','order.confirmed','order.cancelled','fiscal.ready_for_review','visit.scheduled','charge.paid_reported']::text[]
  and cardinality(events) > 0);

grant execute on all functions in schema api to ninebike_api;
revoke execute on function api.fail(text, jsonb) from ninebike_api;
revoke all on all functions in schema integrations, crm, finance from public;
revoke all on all tables in schema integrations, crm, finance from public;
alter table integrations.ai_attributions enable row level security;
alter table crm.visits enable row level security;
alter table finance.ai_charges enable row level security;
alter table finance.ai_commission_rules enable row level security;
