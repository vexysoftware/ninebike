// T04: lead → oportunidade → proposta com preço do catálogo → reserva → pedido; aparece no Registro de vendas.
import { expect, test } from '@playwright/test';
import { login, mobile, uniq } from './helpers';

test('venda completa até pedido confirmado (sem cobrança fictícia)', async ({ page, request }) => {
  const token = (await (await request.post('/api/v1/dev/login', { data: { email: 'dono@ninebike.local' } })).json()).data.access_token;
  const h = { authorization: `Bearer ${token}` };
  const pol = await (await request.get('/api/v1/commercial-policy', { headers: h })).json();
  if (!pol.data) await request.post('/api/v1/admin/policy-versions', { headers: { ...h, 'idempotency-key': crypto.randomUUID() },
    data: { expected_revision: 0, reservation_minutes: 2880, quote_validity_minutes: 10080, seller_max_discount_bps: 500 } });
  const bike = `Venda E2E ${uniq()}`;
  await request.post('/api/v1/catalog/products', { headers: { ...h, 'idempotency-key': crypto.randomUUID() }, data: { name: bike, initial_quantity: 1, sale_price_cents: '990000' } });

  await login(page, 'dono@ninebike.local');
  const lead = `Comprador ${uniq()}`;
  await page.goto('/app/pipeline');
  await page.getByRole('button', { name: 'Novo lead' }).click();
  const dlg = page.getByRole('dialog', { name: 'Novo contato' });
  await dlg.getByLabel('Nome').fill(lead);
  await dlg.getByLabel('Celular').fill(mobile());
  await dlg.getByRole('button', { name: 'Salvar contato' }).click();
  await page.getByRole('dialog', { name: lead }).getByRole('link', { name: 'Criar proposta' }).click();

  await page.getByLabel('Adicionar produto').fill(bike);
  await page.getByRole('button', { name: 'Buscar' }).click();
  await page.getByRole('button', { name: 'Adicionar' }).click();
  await page.getByRole('button', { name: 'Salvar proposta' }).click();
  await expect(page.getByRole('heading', { name: `Proposta · ${lead}` })).toBeVisible();
  await expect(page.getByText('R$ 9.900,00').last()).toBeVisible();

  await page.getByRole('button', { name: 'Reservar estoque' }).click();
  await expect(page.getByText(/Reservado até/)).toBeVisible();
  await page.getByRole('button', { name: 'Confirmar pedido' }).click();
  await expect(page.getByRole('heading', { name: /Pedido #\d+/ })).toBeVisible();
  await expect(page.locator('.stat').filter({ hasText: 'Pagamento' })).toContainText('Aguardando pagamento');
  await expect(page.locator('.stat').filter({ hasText: 'Nota fiscal' })).toContainText('Nota não preparada');

  // Nota: rascunho a partir do pedido; validar mostra pendências; envio desligado.
  await page.getByRole('button', { name: 'Preparar nota' }).click();
  await expect(page.getByText('Envio à SEFAZ desligado')).toBeVisible();
  await page.getByRole('button', { name: 'Validar' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Pendências para validar' })).toContainText('NCM');

  await page.goto('/app/vendas');
  await expect(page.getByRole('row').filter({ hasText: lead })).toBeVisible();
});
