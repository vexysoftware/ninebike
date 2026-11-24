-- NINEBIKE OS — painel da visão geral. Escopo: SELLER vê os próprios números; OWNER vê a loja.
-- Mês corrente em America/Sao_Paulo. Pedidos cancelados não contam como venda.
create or replace function api.dashboard(p_actor uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_role text := identity.require_actor(p_actor); v_owner boolean; v_from timestamptz; v_prev timestamptz;
begin
  v_owner := v_role = 'OWNER';
  v_from := date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
  v_prev := (date_trunc('month', now() at time zone 'America/Sao_Paulo') - interval '1 month') at time zone 'America/Sao_Paulo';
  return jsonb_build_object(
    'month', (select jsonb_build_object('orders', count(*), 'total_cents', coalesce(sum(total_cents), 0)::text,
                'average_cents', coalesce(round(avg(total_cents)), 0)::bigint::text)
              from sales.orders where commercial_state <> 'CANCELLED' and confirmed_at >= v_from and (v_owner or owner_id = p_actor)),
    'previous_month', (select jsonb_build_object('orders', count(*), 'total_cents', coalesce(sum(total_cents), 0)::text)
              from sales.orders where commercial_state <> 'CANCELLED' and confirmed_at >= v_prev and confirmed_at < v_from
                and (v_owner or owner_id = p_actor)),
    'ranking', case when v_owner then coalesce((select jsonb_agg(x order by (x->>'total')::bigint desc) from (
                select jsonb_build_object('seller_name', pr.name, 'orders', count(o.id), 'total', coalesce(sum(o.total_cents), 0)::text) x
                  from identity.profiles pr join sales.orders o on o.owner_id = pr.id
                 where o.commercial_state <> 'CANCELLED' and o.confirmed_at >= v_from group by pr.id, pr.name) t), '[]'::jsonb) end,
    'my_commission_cents', (select coalesce(sum(e.amount_cents), 0)::text from finance.staff_commission_entries e
              join sales.orders o on o.id = e.order_id where e.seller_id = p_actor and e.state <> 'REVERSED' and o.confirmed_at >= v_from),
    'commission_configured', exists (select 1 from finance.staff_commission_rules),
    'low_stock', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'available', (inventory.counts(x)->>'available')::int,
                 'minimum', coalesce(x.minimum_stock, 0)) order by x.name)
              from inventory.products x where x.active and x.tracking is not null and x.inventory_opening_state = 'CONFIRMED'
               and (inventory.counts(x)->>'available')::int <= coalesce(x.minimum_stock, 0)), '[]'::jsonb),
    'active_reservations', (select count(*) from inventory.reservation_groups g join sales.quotes q on q.id = g.quote_id
              where g.state = 'ACTIVE' and g.expires_at > now() and (v_owner or q.owner_id = p_actor)),
    'fiscal_pending_review', case when v_owner then (select count(*) from fiscal.fiscal_documents where review_state in ('DRAFT', 'INVALID', 'READY_FOR_REVIEW')) end,
    'new_leads_7d', (select count(*) from crm.opportunities o where o.created_at > now() - interval '7 days'
              and o.source in ('landing', 'whatsapp_ai') and (v_owner or o.owner_id = p_actor)));
end $$;
grant execute on function api.dashboard(uuid) to ninebike_api;
