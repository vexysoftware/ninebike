-- NINEBIKE OS — automações e reforço de segurança.
--
-- Automações (sem IA, sem mensagens enviadas pelo sistema):
--   * lead novo (site/IA) → tarefa "Responder lead" para o responsável, vencendo em 1 h;
--   * pedido confirmado → tarefas de pós-venda em 7 e 30 dias para a vendedora;
--   * eventos (lead novo, pedido confirmado/cancelado, nota pronta p/ revisão) vão para uma fila (outbox)
--     e o Worker entrega aos webhooks cadastrados (ex.: n8n) com assinatura HMAC-SHA256 e novas tentativas;
--   * manutenção periódica: expira reservas vencidas, limpa registros técnicos antigos.
-- Segurança:
--   * chave da IA com validade opcional e lista de IPs permitidos;
--   * bloqueio temporário de chave após excesso de tentativas com hash inválido não é possível sem
--     identificar a chave — o limite por minuto continua por chave válida;
--   * limite geral por usuário humano na API (600 req/min) e registro de recusas.

-- ============================================================ chaves da IA: validade e IPs
alter table integrations.agent_clients add column expires_at timestamptz;
alter table integrations.agent_clients add column allowed_ips text[] not null default '{}'
  check (cardinality(allowed_ips) <= 20);

-- p_token_hash chega como '<sha256>' ou '<sha256>@<ip do cliente>' (montado pelo Worker, nunca pelo cliente).
create or replace function integrations.agent_require(p_token_hash text, p_scope text, p_action text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v integrations.agent_clients%rowtype; v_n int; v_hash text := split_part(p_token_hash, '@', 1);
        v_ip text := nullif(split_part(p_token_hash, '@', 2), '');
begin
  select * into v from integrations.agent_clients where token_hash = v_hash and revoked_at is null;
  if not found then perform api.fail('AUTH_REQUIRED'); end if;
  if v.expires_at is not null and v.expires_at <= now() then perform api.fail('AUTH_REQUIRED', jsonb_build_object('reason', 'key_expired')); end if;
  if cardinality(v.allowed_ips) > 0 and (v_ip is null or not (v_ip = any(v.allowed_ips))) then
    perform api.fail('PERMISSION_DENIED', jsonb_build_object('reason', 'ip_not_allowed'));
  end if;
  if not (p_scope = any(v.scopes)) then perform api.fail('PERMISSION_DENIED', jsonb_build_object('scope', p_scope)); end if;
  select count(*) into v_n from integrations.agent_requests where client_id = v.id and at > now() - interval '1 minute';
  if v_n >= 120 then perform api.fail('RATE_LIMITED'); end if;
  insert into integrations.agent_requests (client_id, action) values (v.id, p_action);
  update integrations.agent_clients set last_used_at = now() where id = v.id;
  return v.id;
end $$;

create or replace function api.agent_client_create(p_ctx jsonb, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (p_ctx->>'actor_id')::uuid; v_id uuid; v_scopes text[]; v_ips text[];
begin
  perform identity.require_actor(v_actor, 'users.manage');
  if not coalesce((p_ctx->>'mfa_recent')::boolean, false) then perform api.fail('MFA_RECENCY_REQUIRED'); end if;
  select array_agg(distinct s order by s) into v_scopes from jsonb_array_elements_text(p->'scopes') s;
  select coalesce(array_agg(distinct s order by s), '{}') into v_ips from jsonb_array_elements_text(coalesce(p->'allowed_ips', '[]')) s;
  insert into integrations.agent_clients (name, token_hash, token_prefix, scopes, created_by, expires_at, allowed_ips)
  values (btrim(p->>'name'), p->>'token_hash', p->>'token_prefix', v_scopes, v_actor,
          case when p->>'expires_in_days' is null then null else now() + make_interval(days => (p->>'expires_in_days')::int) end, v_ips)
  returning id into v_id;
  perform audit.record(p_ctx, 'agent_client.created', 'agent_client', v_id,
    jsonb_build_object('name', btrim(p->>'name'), 'scopes', to_jsonb(v_scopes), 'allowed_ips', to_jsonb(v_ips), 'expires_in_days', p->'expires_in_days'));
  return jsonb_build_object('id', v_id, 'name', btrim(p->>'name'), 'scopes', to_jsonb(v_scopes), 'token_prefix', p->>'token_prefix');
end $$;

create or replace function api.agent_client_list(p_actor uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform identity.require_actor(p_actor, 'users.manage');
  return coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'token_prefix', c.token_prefix,
      'scopes', to_jsonb(c.scopes), 'allowed_ips', to_jsonb(c.allowed_ips), 'expires_at', c.expires_at,
      'created_at', c.created_at, 'created_by_name', pr.name, 'revoked_at', c.revoked_at, 'last_used_at', c.last_used_at,
      'requests_24h', (select count(*) from integrations.agent_requests r where r.client_id = c.id and r.at > now() - interval '24 hours'))
    order by c.revoked_at nulls first, c.created_at desc)
    from integrations.agent_clients c join identity.profiles pr on pr.id = c.created_by), '[]'::jsonb);
end $$;

-- ============================================================ limite geral por usuário humano
create table integrations.api_rate (
  actor_id uuid not null,
  window_start timestamptz not null,
  hits integer not null,
  primary key (actor_id, window_start)
);
create or replace function api.rate_hit(p_actor uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_w timestamptz := date_trunc('minute', now()); v_h int;
begin
  insert into integrations.api_rate (actor_id, window_start, hits) values (p_actor, v_w, 1)
  on conflict (actor_id, window_start) do update set hits = integrations.api_rate.hits + 1 returning hits into v_h;
  return v_h <= 600;
end $$;

-- ============================================================ tarefas automáticas
create or replace function crm.auto_task_on_lead() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.source in ('landing', 'whatsapp_ai') then
    insert into crm.activities (contact_id, opportunity_id, author_id, kind, body, due_at)
    values (new.contact_id, new.id, new.owner_id, 'TASK',
            case new.source when 'whatsapp_ai' then 'Responder lead vindo da IA do WhatsApp' else 'Responder lead do site' end,
            now() + interval '1 hour');
  end if;
  return new;
end $$;
create trigger opportunity_auto_task after insert on crm.opportunities for each row execute function crm.auto_task_on_lead();

create or replace function sales.auto_after_sale() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_opp uuid;
begin
  select id into v_opp from crm.opportunities where contact_id = new.contact_id order by updated_at desc limit 1;
  insert into crm.activities (contact_id, opportunity_id, author_id, kind, body, due_at) values
    (new.contact_id, v_opp, new.owner_id, 'TASK', format('Pós-venda pedido #%s: como está a bike? Pedir avaliação/indicação', new.display_number), now() + interval '7 days'),
    (new.contact_id, v_opp, new.owner_id, 'TASK', format('Pedido #%s: lembrar revisão de 30 dias e oferecer acessórios', new.display_number), now() + interval '30 days');
  return new;
end $$;
create trigger order_after_sale after insert on sales.orders for each row execute function sales.auto_after_sale();

-- ============================================================ webhooks (outbox)
create table integrations.webhook_endpoints (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> '' and length(name) <= 80),
  url text not null check (url ~ '^https://[^/\s]+' and length(url) <= 500),
  secret text not null check (length(secret) >= 32),
  events text[] not null check (events <@ array['lead.created','order.confirmed','order.cancelled','fiscal.ready_for_review']::text[] and cardinality(events) > 0),
  active boolean not null default true,
  created_by uuid not null references identity.profiles(id),
  created_at timestamptz not null default now(),
  last_success_at timestamptz, last_error text
);

create table integrations.outbox (
  id uuid primary key default gen_random_uuid(),
  endpoint_id uuid not null references integrations.webhook_endpoints(id),
  event text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  locked_until timestamptz,
  delivered_at timestamptz,
  failed_at timestamptz,
  last_error text
);
create index outbox_pending on integrations.outbox (next_attempt_at) where delivered_at is null and failed_at is null;

create or replace function integrations.enqueue(p_event text, p_payload jsonb) returns void
language sql security definer set search_path = '' as $$
  insert into integrations.outbox (endpoint_id, event, payload)
  select id, p_event, jsonb_build_object('event', p_event, 'occurred_at', now(), 'data', p_payload)
    from integrations.webhook_endpoints where active and p_event = any(events)
$$;

-- Payloads mínimos: sem CPF, e-mail, endereço, custo ou margem.
create or replace function integrations.on_opportunity_event() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.source in ('landing', 'whatsapp_ai') then
    perform integrations.enqueue('lead.created', (select jsonb_build_object('opportunity_id', new.id, 'source', new.source,
      'name', c.name, 'mobile_phone', c.mobile_e164, 'seller_name', (select name from identity.profiles where id = new.owner_id),
      'interest_product', (select name from inventory.products where id = new.interest_product_id))
      from crm.contacts c where c.id = new.contact_id));
  end if;
  return new;
end $$;
create trigger opportunity_outbox after insert on crm.opportunities for each row execute function integrations.on_opportunity_event();

create or replace function integrations.on_order_event() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v jsonb;
begin
  v := jsonb_build_object('order_id', new.id, 'number', new.display_number, 'total_cents', new.total_cents::text,
    'customer_name', new.customer_snapshot->>'name', 'mobile_phone', (select mobile_e164 from crm.contacts where id = new.contact_id),
    'seller_name', (select name from identity.profiles where id = new.owner_id),
    'items', (select jsonb_agg(i.description_snapshot order by i.position) from sales.order_items i where i.order_id = new.id));
  if tg_op = 'INSERT' then perform integrations.enqueue('order.confirmed', v);
  elsif new.commercial_state = 'CANCELLED' and old.commercial_state <> 'CANCELLED' then perform integrations.enqueue('order.cancelled', v);
  end if;
  return new;
end $$;
-- Itens são gravados depois do pedido na mesma transação: disparo adiado para o commit.
create constraint trigger order_outbox after insert or update of commercial_state on sales.orders
  deferrable initially deferred for each row execute function integrations.on_order_event();

create or replace function integrations.on_fiscal_event() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.review_state = 'READY_FOR_REVIEW' and (tg_op = 'INSERT' or old.review_state is distinct from 'READY_FOR_REVIEW') then
    perform integrations.enqueue('fiscal.ready_for_review', jsonb_build_object('fiscal_document_id', new.id,
      'order_number', (select display_number from sales.orders where id = new.order_id)));
  end if;
  return new;
end $$;
create trigger fiscal_outbox after insert or update of review_state on fiscal.fiscal_documents
  for each row execute function integrations.on_fiscal_event();

-- Administração (OWNER). O segredo de assinatura nasce no Worker e é mostrado uma vez.
create or replace function api.webhook_list(p_actor uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform identity.require_actor(p_actor, 'users.manage');
  return coalesce((select jsonb_agg(jsonb_build_object('id', w.id, 'name', w.name, 'url', w.url, 'events', to_jsonb(w.events),
      'active', w.active, 'created_at', w.created_at, 'last_success_at', w.last_success_at, 'last_error', w.last_error,
      'pending', (select count(*) from integrations.outbox o where o.endpoint_id = w.id and o.delivered_at is null and o.failed_at is null),
      'failed_7d', (select count(*) from integrations.outbox o where o.endpoint_id = w.id and o.failed_at > now() - interval '7 days'))
    order by w.created_at desc) from integrations.webhook_endpoints w), '[]'::jsonb);
end $$;

create or replace function api.webhook_create(p_ctx jsonb, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (p_ctx->>'actor_id')::uuid; v_id uuid;
begin
  perform identity.require_actor(v_actor, 'users.manage');
  if not coalesce((p_ctx->>'mfa_recent')::boolean, false) then perform api.fail('MFA_RECENCY_REQUIRED'); end if;
  insert into integrations.webhook_endpoints (name, url, secret, events, created_by)
  values (btrim(p->>'name'), p->>'url', p->>'secret', array(select distinct jsonb_array_elements_text(p->'events')), v_actor)
  returning id into v_id;
  perform audit.record(p_ctx, 'webhook.created', 'webhook', v_id, jsonb_build_object('url', p->>'url', 'events', p->'events'));
  return jsonb_build_object('id', v_id);
end $$;

create or replace function api.webhook_set_active(p_ctx jsonb, p_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform identity.require_actor((p_ctx->>'actor_id')::uuid, 'users.manage');
  update integrations.webhook_endpoints set active = (p->>'active')::boolean where id = p_id;
  if not found then perform api.fail('NOT_FOUND'); end if;
  if not (p->>'active')::boolean then
    update integrations.outbox set failed_at = now(), last_error = 'endpoint desativado'
     where endpoint_id = p_id and delivered_at is null and failed_at is null;
  end if;
  perform audit.record(p_ctx, 'webhook.active_changed', 'webhook', p_id, p);
  return jsonb_build_object('id', p_id, 'active', (p->>'active')::boolean);
end $$;

-- Funções do job (Worker agendado). Sem ator humano; claim com lock temporário para não duplicar entrega.
create or replace function api.job_outbox_claim(p_limit int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v jsonb;
begin
  with picked as (
    select o.id from integrations.outbox o
     where o.delivered_at is null and o.failed_at is null and o.next_attempt_at <= now()
       and (o.locked_until is null or o.locked_until < now())
     order by o.next_attempt_at limit least(greatest(p_limit, 1), 50) for update skip locked),
  locked as (
    update integrations.outbox o set locked_until = now() + interval '2 minutes' from picked where o.id = picked.id
    returning o.id, o.endpoint_id, o.event, o.payload, o.attempts)
  select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'url', w.url, 'secret', w.secret, 'event', l.event,
           'payload', l.payload, 'attempts', l.attempts)), '[]'::jsonb) into v
    from locked l join integrations.webhook_endpoints w on w.id = l.endpoint_id;
  return v;
end $$;

create or replace function api.job_outbox_result(p_id uuid, p_ok boolean, p_error text) returns void
language plpgsql security definer set search_path = '' as $$
declare o integrations.outbox%rowtype;
begin
  select * into o from integrations.outbox where id = p_id for update;
  if not found then return; end if;
  if p_ok then
    update integrations.outbox set delivered_at = now(), attempts = attempts + 1, locked_until = null, last_error = null where id = p_id;
    update integrations.webhook_endpoints set last_success_at = now(), last_error = null where id = o.endpoint_id;
  else
    -- Backoff: 1, 2, 4, 8 ... min (até 6 h); desiste após 12 tentativas.
    update integrations.outbox set attempts = attempts + 1, locked_until = null, last_error = left(p_error, 300),
      next_attempt_at = now() + least(interval '1 minute' * power(2, attempts), interval '6 hours'),
      failed_at = case when attempts + 1 >= 12 then now() end
     where id = p_id;
    update integrations.webhook_endpoints set last_error = left(p_error, 300) where id = o.endpoint_id;
  end if;
end $$;

create or replace function api.job_maintenance() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_res int; v_req int; v_rate int; v_box int;
begin
  select count(*) into v_res from inventory.reservation_groups where state = 'ACTIVE' and expires_at <= now();
  perform inventory.expire_reservations(null);
  delete from integrations.agent_requests where at < now() - interval '30 days'; get diagnostics v_req = row_count;
  delete from integrations.api_rate where window_start < now() - interval '10 minutes'; get diagnostics v_rate = row_count;
  delete from integrations.outbox where coalesce(delivered_at, failed_at) < now() - interval '30 days'; get diagnostics v_box = row_count;
  return jsonb_build_object('reservations_expired', v_res, 'agent_requests_purged', v_req, 'rate_rows_purged', v_rate, 'outbox_purged', v_box);
end $$;

grant execute on all functions in schema api to ninebike_api;
revoke execute on function api.fail(text, jsonb) from ninebike_api;
revoke all on all functions in schema integrations, crm, sales from public;
revoke all on all tables in schema integrations from public;
alter table integrations.api_rate enable row level security;
alter table integrations.webhook_endpoints enable row level security;
alter table integrations.outbox enable row level security;
