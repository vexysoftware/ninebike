-- NINEBIKE OS — grants. Browser (anon/authenticated) não lê nem escreve tabelas internas nem executa RPCs.
-- O Worker usa ninebike_api, que só executa funções do schema api. Funções internas não são executáveis por ninguém além do dono.

do $$
declare s text;
begin
  foreach s in array array['identity','audit','integrations','crm','inventory','api'] loop
    execute format('revoke all on all tables in schema %I from public', s);
    execute format('revoke all on all sequences in schema %I from public', s);
    execute format('revoke all on all functions in schema %I from public', s);
    execute format('alter default privileges in schema %I revoke execute on functions from public', s);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on all tables in schema %I from anon, authenticated', s);
      execute format('revoke all on all functions in schema %I from anon, authenticated', s);
    end if;
  end loop;
end $$;

-- RLS habilitada sem políticas: mesmo que algum grant escape, nenhuma linha é visível pelo PostgREST.
do $$
declare r record;
begin
  for r in select schemaname, tablename from pg_tables
            where schemaname in ('identity','audit','integrations','crm','inventory') loop
    execute format('alter table %I.%I enable row level security', r.schemaname, r.tablename);
  end loop;
end $$;

grant execute on all functions in schema api to ninebike_api;
revoke execute on function api.fail(text, jsonb) from ninebike_api;
