-- Importação de contatos do sistema anterior (CSV). Somente OWNER (crm.manage).
-- Regras: nada é mesclado automaticamente — celular ou CPF já existente é pulado e relatado;
-- contato importado é cliente pré-existente da loja e NUNCA é atribuído à IA (não entra na comissão da IA).
alter table crm.contacts add column imported_at timestamptz;
alter table crm.contacts add column import_batch_id uuid;

create table crm.import_batches (
  id uuid primary key,
  file_name text not null check (length(file_name) <= 200),
  owner_id uuid not null references identity.profiles(id),
  created_by uuid not null references identity.profiles(id),
  created integer not null default 0,
  skipped integer not null default 0,
  invalid integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table crm.import_batches enable row level security;

-- Atribuição à IA ignora clientes importados.
create or replace function integrations.attribute(p_contact uuid, p_client uuid, p_reason text) returns void
language sql security definer set search_path = '' as $$
  insert into integrations.ai_attributions (contact_id, client_id, first_reason)
  select p_contact, p_client, p_reason
   where not exists (select 1 from crm.contacts where id = p_contact and imported_at is not null)
  on conflict (contact_id) do nothing
$$;

create or replace function api.contact_import(p_ctx jsonb, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (p_ctx->>'actor_id')::uuid; v_owner uuid; r jsonb; c crm.contacts%rowtype;
        v_created int := 0; v_skipped jsonb := '[]'::jsonb; v_batch uuid := (p->>'batch_id')::uuid;
begin
  perform identity.require_actor(v_actor, 'crm.manage');
  v_owner := coalesce((p->>'owner_id')::uuid, v_actor);
  if not exists (select 1 from identity.profiles where id = v_owner and active) then
    perform api.fail('VALIDATION_FAILED', jsonb_build_object('field', 'owner_id', 'reason', 'inactive_or_unknown'));
  end if;
  insert into crm.import_batches (id, file_name, owner_id, created_by) values (v_batch, coalesce(p->>'file_name', 'importação'), v_owner, v_actor)
  on conflict (id) do nothing;
  for r in select * from jsonb_array_elements(p->'rows') loop
    if exists (select 1 from crm.contacts x where x.mobile_e164 = r->>'mobile_e164')
       or (r->>'cpf' is not null and exists (select 1 from crm.contacts x where x.cpf = r->>'cpf')) then
      v_skipped := v_skipped || jsonb_build_object('line', r->'line', 'reason', 'already_exists');
      continue;
    end if;
    insert into crm.contacts (name, mobile_e164, cpf, email, note, person_type, birthday_day, birthday_month, birthday_year,
                              owner_id, imported_at, import_batch_id)
    values (btrim(r->>'name'), r->>'mobile_e164', r->>'cpf', r->>'email', r->>'note', case when r->>'cpf' is not null then 'PF' end,
            (r->>'birthday_day')::smallint, (r->>'birthday_month')::smallint, (r->>'birthday_year')::smallint,
            v_owner, now(), v_batch)
    returning * into c;
    insert into crm.contact_roles (contact_id, role) values (c.id, 'CUSTOMER');
    v_created := v_created + 1;
  end loop;
  update crm.import_batches set created = created + v_created, skipped = skipped + jsonb_array_length(v_skipped),
         invalid = invalid + coalesce((p->>'invalid_count')::int, 0), updated_at = now() where id = v_batch;
  perform audit.record(p_ctx, 'contact.imported', 'import_batch', v_batch,
    jsonb_build_object('created', v_created, 'skipped', jsonb_array_length(v_skipped)));
  return jsonb_build_object('created', v_created, 'skipped', v_skipped);
end $$;

create or replace function api.import_batch_list(p_actor uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform identity.require_actor(p_actor, 'crm.manage');
  return coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'file_name', b.file_name, 'owner_name', pr.name,
      'created', b.created, 'skipped', b.skipped, 'invalid', b.invalid, 'created_at', b.created_at) order by b.created_at desc)
    from crm.import_batches b join identity.profiles pr on pr.id = b.owner_id), '[]'::jsonb);
end $$;

grant execute on function api.contact_import(jsonb, jsonb), api.import_batch_list(uuid) to ninebike_api;
revoke all on function integrations.attribute(uuid, uuid, text) from public;
