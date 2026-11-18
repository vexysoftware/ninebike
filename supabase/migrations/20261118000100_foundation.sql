-- NINEBIKE OS — T01 fundação: identidade, auditoria, recibos de comando e papel de backend.
-- Supabase fornece auth.users e os papéis anon/authenticated/service_role.
-- Nenhuma tabela interna é exposta ao browser: só o papel ninebike_api executa funções do schema api.

create extension if not exists pgcrypto;

-- Papel usado pelo Worker (via Hyperdrive). Login/senha são configurados fora do Git, por ambiente.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'ninebike_api') then
    create role ninebike_api nologin;
  end if;
end $$;

create schema if not exists identity;
create schema if not exists audit;
create schema if not exists integrations;
create schema if not exists api;

revoke all on schema identity, audit, integrations, api from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on schema identity, audit, integrations, api from anon, authenticated';
  end if;
end $$;
grant usage on schema api to ninebike_api;

-- ---------------------------------------------------------------- erros estáveis
-- As funções levantam 'NB:<CODE>' com DETAIL em JSON seguro; o adaptador HTTP traduz para o contrato.
create or replace function api.fail(p_code text, p_details jsonb default '{}'::jsonb)
returns void language plpgsql as $$
begin
  raise exception using message = 'NB:' || p_code, detail = coalesce(p_details, '{}'::jsonb)::text;
end $$;

-- ---------------------------------------------------------------- identidade
create table identity.profiles (
  id uuid primary key references auth.users(id) on delete restrict,
  name text not null check (btrim(name) <> ''),
  email text,
  active boolean not null default true,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table identity.user_roles (
  user_id uuid primary key references identity.profiles(id) on delete restrict,
  role text not null check (role in ('SELLER', 'OWNER')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table identity.invitations (
  id uuid primary key default gen_random_uuid(),
  email text not null check (email = lower(btrim(email)) and email like '%_@_%'),
  name text not null check (btrim(name) <> ''),
  role text not null check (role in ('SELLER', 'OWNER')),
  state text not null default 'PENDING' check (state in ('PENDING', 'ACCEPTED', 'REVOKED')),
  invited_by uuid not null references identity.profiles(id),
  profile_id uuid references identity.profiles(id),
  created_at timestamptz not null default now(),
  accepted_at timestamptz
);
create unique index invitations_pending_email on identity.invitations (email) where state = 'PENDING';

-- Catálogo fechado de permissões por perfil (teto). Concessões avulsas não existem nesta versão:
-- o perfil define o teto e o escopo (SELLER = carteira atribuída, OWNER = loja).
create or replace function identity.role_permissions(p_role text)
returns text[] language sql immutable as $$
  select case p_role
    when 'SELLER' then array['crm.read','crm.write','catalog.read','inventory.read']
    when 'OWNER' then array['crm.read','crm.write','crm.manage','pipeline.manage','suppliers.read',
                            'suppliers.write','catalog.read','catalog.manage','inventory.read',
                            'inventory.manage','inventory.cost.read','users.manage','audit.read']
    else array[]::text[] end
$$;

-- Revalida o ator no commit: perfil ativo, papel atual e permissão. JWT válido não basta.
create or replace function identity.require_actor(p_actor uuid, p_permission text default null)
returns text language plpgsql stable security definer set search_path = '' as $$
declare v_role text;
begin
  select r.role into v_role
    from identity.profiles p join identity.user_roles r on r.user_id = p.id
   where p.id = p_actor and p.active;
  if v_role is null then perform api.fail('AUTH_REQUIRED'); end if;
  if p_permission is not null and not (p_permission = any(identity.role_permissions(v_role))) then
    perform api.fail('PERMISSION_DENIED', jsonb_build_object('permission', p_permission));
  end if;
  return v_role;
end $$;

-- Convite aceito: quando o Supabase Auth cria o usuário convidado, o perfil nasce com o papel do convite.
-- Signup sem convite pendente não ganha perfil, papel ou acesso.
create or replace function identity.on_auth_user_created()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_inv identity.invitations%rowtype;
begin
  select * into v_inv from identity.invitations
   where email = lower(btrim(new.email)) and state = 'PENDING' for update;
  if not found then return new; end if;
  insert into identity.profiles (id, name, email) values (new.id, v_inv.name, v_inv.email);
  insert into identity.user_roles (user_id, role) values (new.id, v_inv.role);
  update identity.invitations set state = 'ACCEPTED', accepted_at = now(), profile_id = new.id
   where id = v_inv.id;
  insert into audit.audit_events (actor_id, actor_kind, action, resource_type, resource_id, decision, before_after)
  values (v_inv.invited_by, 'SYSTEM', 'invitation.accepted', 'profile', new.id, 'ALLOW',
          jsonb_build_object('role', v_inv.role));
  return new;
end $$;

-- ---------------------------------------------------------------- auditoria append-only
create table audit.audit_events (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  actor_id uuid,
  actor_kind text not null check (actor_kind in ('HUMAN', 'SYSTEM', 'JOB')),
  action text not null,
  resource_type text not null,
  resource_id uuid,
  correlation_id uuid,
  decision text not null check (decision in ('ALLOW', 'DENY')),
  before_after jsonb not null default '{}'::jsonb,
  deploy_id text
);
create index audit_events_resource on audit.audit_events (resource_type, resource_id, occurred_at);

create or replace function audit.forbid_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'append-only table %', tg_table_name;
end $$;
create trigger audit_events_append_only before update or delete on audit.audit_events
  for each row execute function audit.forbid_mutation();

create or replace function audit.record(p_ctx jsonb, p_action text, p_resource_type text,
                                        p_resource_id uuid, p_before_after jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into audit.audit_events (actor_id, actor_kind, action, resource_type, resource_id,
                                  correlation_id, decision, before_after, deploy_id)
  values ((p_ctx->>'actor_id')::uuid, 'HUMAN', p_action, p_resource_type, p_resource_id,
          nullif(p_ctx->>'request_id', '')::uuid, 'ALLOW', coalesce(p_before_after, '{}'::jsonb),
          nullif(p_ctx->>'deploy_id', ''))
$$;

-- ---------------------------------------------------------------- idempotência de comandos
create table integrations.command_receipts (
  actor_id uuid not null references identity.profiles(id),
  command_name text not null,
  idem_key uuid not null,
  request_hash text not null,
  status_code integer not null,
  response jsonb not null,
  created_at timestamptz not null default now(),
  primary key (actor_id, command_name, idem_key)
);

-- Busca recibo travando a chave; mesma chave e hash devolve a resposta original; hash diferente é conflito.
create or replace function api.receipt_begin(p_actor uuid, p_command text, p_key uuid, p_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v integrations.command_receipts%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_actor::text || ':' || p_command || ':' || p_key::text, 0));
  select * into v from integrations.command_receipts
   where actor_id = p_actor and command_name = p_command and idem_key = p_key;
  if not found then return null; end if;
  if v.request_hash <> p_hash then perform api.fail('IDEMPOTENCY_CONFLICT'); end if;
  return jsonb_build_object('status', v.status_code, 'body', v.response);
end $$;

create or replace function api.receipt_store(p_actor uuid, p_command text, p_key uuid, p_hash text,
                                             p_status integer, p_body jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into integrations.command_receipts (actor_id, command_name, idem_key, request_hash, status_code, response)
  values (p_actor, p_command, p_key, p_hash, p_status, p_body)
$$;

-- ---------------------------------------------------------------- sessão e administração
create or replace function api.session(p_actor uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_role text; v jsonb;
begin
  v_role := identity.require_actor(p_actor);
  select jsonb_build_object('user_id', p.id, 'name', p.name, 'email', p.email, 'profile', v_role,
         'scope', case v_role when 'OWNER' then 'STORE' else 'ASSIGNED' end,
         'permissions', to_jsonb(identity.role_permissions(v_role)))
    into v from identity.profiles p where p.id = p_actor;
  return v;
end $$;

create or replace function api.admin_list_users(p_actor uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform identity.require_actor(p_actor, 'users.manage');
  return jsonb_build_object(
    'users', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'email', p.email,
              'active', p.active, 'profile', r.role, 'version', p.version) order by p.name)
       from identity.profiles p join identity.user_roles r on r.user_id = p.id), '[]'::jsonb),
    'invitations', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'email', i.email, 'name', i.name,
              'profile', i.role, 'created_at', i.created_at) order by i.created_at)
       from identity.invitations i where i.state = 'PENDING'), '[]'::jsonb));
end $$;

create or replace function api.admin_create_invitation(p_ctx jsonb, p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (p_ctx->>'actor_id')::uuid; v_id uuid; v_email text := lower(btrim(p->>'email'));
begin
  perform identity.require_actor(v_actor, 'users.manage');
  if coalesce((p_ctx->>'mfa_recent')::boolean, false) is not true then perform api.fail('MFA_RECENCY_REQUIRED'); end if;
  if exists (select 1 from identity.profiles where lower(email) = v_email) then
    perform api.fail('VALIDATION_FAILED', jsonb_build_object('field', 'email', 'reason', 'already_member'));
  end if;
  if exists (select 1 from identity.invitations where email = v_email and state = 'PENDING') then
    perform api.fail('OPERATION_IN_PROGRESS', jsonb_build_object('reason', 'invitation_pending'));
  end if;
  insert into identity.invitations (email, name, role, invited_by)
  values (v_email, btrim(p->>'name'), p->>'profile', v_actor) returning id into v_id;
  perform audit.record(p_ctx, 'invitation.created', 'invitation', v_id, jsonb_build_object('profile', p->>'profile'));
  return jsonb_build_object('id', v_id, 'email', v_email);
end $$;

-- Ativa/desativa e troca perfil. Trava o conjunto de donos para proteger o último OWNER ativo.
create or replace function api.admin_update_access(p_ctx jsonb, p_user uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (p_ctx->>'actor_id')::uuid;
  v_prof identity.profiles%rowtype; v_role text; v_new_role text; v_new_active boolean; v_owners int;
begin
  perform identity.require_actor(v_actor, 'users.manage');
  if coalesce((p_ctx->>'mfa_recent')::boolean, false) is not true then perform api.fail('MFA_RECENCY_REQUIRED'); end if;
  perform 1 from identity.user_roles where role = 'OWNER' order by user_id for update;
  select * into v_prof from identity.profiles where id = p_user for update;
  if not found then perform api.fail('NOT_FOUND'); end if;
  if v_prof.version <> (p->>'expected_version')::int then perform api.fail('VERSION_CONFLICT'); end if;
  select role into v_role from identity.user_roles where user_id = p_user;
  v_new_role := coalesce(p->>'profile', v_role);
  v_new_active := coalesce((p->>'active')::boolean, v_prof.active);
  if v_role = 'OWNER' and v_prof.active and (v_new_role <> 'OWNER' or not v_new_active) then
    select count(*) into v_owners from identity.profiles pp join identity.user_roles rr on rr.user_id = pp.id
     where rr.role = 'OWNER' and pp.active;
    if v_owners <= 1 then perform api.fail('VALIDATION_FAILED', jsonb_build_object('reason', 'last_active_owner')); end if;
  end if;
  update identity.profiles set active = v_new_active, version = version + 1, updated_at = now() where id = p_user;
  update identity.user_roles set role = v_new_role, updated_at = now() where user_id = p_user;
  perform audit.record(p_ctx, 'access.updated', 'profile', p_user,
    jsonb_build_object('before', jsonb_build_object('profile', v_role, 'active', v_prof.active),
                       'after', jsonb_build_object('profile', v_new_role, 'active', v_new_active)));
  return jsonb_build_object('id', p_user, 'version', v_prof.version + 1);
end $$;

create or replace function api.admin_audit_events(p_actor uuid, p_resource_type text, p_resource_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform identity.require_actor(p_actor, 'audit.read');
  return coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'occurred_at', e.occurred_at, 'actor_id', e.actor_id,
           'actor_name', pr.name, 'action', e.action, 'before_after', e.before_after) order by e.occurred_at desc)
    from (select * from audit.audit_events where resource_type = p_resource_type and resource_id = p_resource_id
           order by occurred_at desc limit 100) e
    left join identity.profiles pr on pr.id = e.actor_id), '[]'::jsonb);
end $$;

create trigger ninebike_on_auth_user_created after insert on auth.users
  for each row execute function identity.on_auth_user_created();
