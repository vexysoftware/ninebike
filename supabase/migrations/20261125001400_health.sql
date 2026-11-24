-- Diagnóstico sem dados pessoais: migrations aplicadas e se já existe proprietário.
create or replace function api.health() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'migrations', (select count(*) from public.ninebike_migrations),
    'last_migration', (select max(name) from public.ninebike_migrations),
    'owner_exists', exists (select 1 from identity.user_roles where role = 'OWNER'),
    'users', (select count(*) from identity.profiles))
$$;
grant execute on function api.health() to ninebike_api;
