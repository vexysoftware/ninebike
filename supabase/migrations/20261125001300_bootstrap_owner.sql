-- Primeiro proprietário sem convite: só enquanto não existe nenhum OWNER. Chamado pelo script de deploy.
create table identity.bootstrap_owner (
  email text primary key check (email = lower(btrim(email))),
  name text not null,
  created_at timestamptz not null default now()
);
alter table identity.bootstrap_owner enable row level security;

create or replace function identity.bootstrap_owner(p_email text, p_name text) returns text
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid;
begin
  if exists (select 1 from identity.user_roles where role = 'OWNER') then return 'já existe proprietário'; end if;
  select id into v_uid from auth.users where lower(email) = lower(p_email);
  if v_uid is null then
    insert into identity.bootstrap_owner (email, name) values (lower(p_email), p_name) on conflict (email) do update set name = excluded.name;
    return 'aguardando o usuário ser criado no Supabase Auth';
  end if;
  insert into identity.profiles (id, name, email) values (v_uid, p_name, lower(p_email)) on conflict (id) do nothing;
  insert into identity.user_roles (user_id, role) values (v_uid, 'OWNER') on conflict do nothing;
  insert into audit.audit_events (actor_kind, action, resource_type, resource_id, decision) values ('SYSTEM', 'bootstrap.owner', 'profile', v_uid, 'ALLOW');
  delete from identity.bootstrap_owner;
  return 'promovido';
end $$;
revoke all on function identity.bootstrap_owner(text, text) from public;

-- Gatilho de criação de usuário: convite pendente (como antes) OU bootstrap do primeiro dono.
create or replace function identity.on_auth_user_created()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_inv identity.invitations%rowtype; v_boot identity.bootstrap_owner%rowtype;
begin
  select * into v_inv from identity.invitations
   where email = lower(btrim(new.email)) and state = 'PENDING' for update;
  if found then
    insert into identity.profiles (id, name, email) values (new.id, v_inv.name, v_inv.email);
    insert into identity.user_roles (user_id, role) values (new.id, v_inv.role);
    update identity.invitations set state = 'ACCEPTED', accepted_at = now(), profile_id = new.id where id = v_inv.id;
    insert into audit.audit_events (actor_id, actor_kind, action, resource_type, resource_id, decision, before_after)
    values (v_inv.invited_by, 'SYSTEM', 'invitation.accepted', 'profile', new.id, 'ALLOW', jsonb_build_object('role', v_inv.role));
    return new;
  end if;
  select * into v_boot from identity.bootstrap_owner where email = lower(btrim(new.email));
  if found and not exists (select 1 from identity.user_roles where role = 'OWNER') then
    insert into identity.profiles (id, name, email) values (new.id, v_boot.name, v_boot.email);
    insert into identity.user_roles (user_id, role) values (new.id, 'OWNER');
    delete from identity.bootstrap_owner;
    insert into audit.audit_events (actor_kind, action, resource_type, resource_id, decision) values ('SYSTEM', 'bootstrap.owner', 'profile', new.id, 'ALLOW');
  end if;
  return new;
end $$;
