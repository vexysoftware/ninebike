-- Clientes esfriando: oportunidades abertas sem nenhum toque (edição ou atividade) há N dias.
create or replace function api.followups(p_actor uuid, p_days int) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_role text := identity.require_actor(p_actor, 'crm.read');
begin
  return coalesce((select jsonb_agg(x order by x->>'last_touch') from (
    select jsonb_build_object('opportunity_id', o.id, 'contact_id', c.id, 'name', c.name, 'mobile_phone', c.mobile_e164,
      'stage', s.name, 'seller_name', pr.name,
      'interest', (select name from inventory.products where id = o.interest_product_id),
      'expected_value_cents', o.expected_value_cents::text, 'last_touch', t.last_touch,
      'days', extract(day from now() - t.last_touch)::int) x
      from crm.opportunities o join crm.pipeline_stages s on s.id = o.stage_id and s.kind = 'OPEN'
      join crm.contacts c on c.id = o.contact_id join identity.profiles pr on pr.id = o.owner_id,
      lateral (select greatest(o.updated_at, coalesce((select max(a.created_at) from crm.activities a where a.opportunity_id = o.id), o.updated_at)) last_touch) t
     where (v_role = 'OWNER' or o.owner_id = p_actor) and t.last_touch < now() - make_interval(days => greatest(p_days, 1))
     order by t.last_touch limit 30) q), '[]'::jsonb);
end $$;
grant execute on function api.followups(uuid, int) to ninebike_api;
