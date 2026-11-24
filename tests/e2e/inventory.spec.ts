// Jornada T03: dono cadastra 3 bikes sem série e convida vendedora; vendedora consulta disponibilidade sem custo e sem ações de estoque.
import { expect, test } from '@playwright/test';
import { login, uniq } from './helpers';

test('dono cadastra 3 bikes sem série; vendedora vê disponibilidade sem custo', async ({ page, browser }) => {
  await login(page, 'dono@ninebike.local');
  const name = `Bike E2E ${uniq()}`;
  await page.goto('/app/estoque');
  await page.getByRole('button', { name: 'Novo produto' }).click();
  const dlg = page.getByRole('dialog', { name: 'Novo produto' });
  await dlg.getByLabel('Nome do modelo').fill(name);
  await dlg.getByLabel('Quantidade inicial').fill('3');
  await dlg.getByLabel(/Preço de venda/).fill('12.900,00');
  await dlg.getByLabel(/Custo unitário/).fill('8.123,45');
  await dlg.getByRole('button', { name: 'Cadastrar produto' }).click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
  await expect(page.locator('.stat').filter({ hasText: 'Disponível' })).toContainText('3');
  await expect(page.getByText('a preencher')).toHaveCount(3);
  await expect(page.getByText('R$ 8.123,45').first()).toBeVisible();

  const sellerEmail = `vendedora-${uniq()}@ninebike.local`;
  await page.goto('/app/configuracoes');
  await page.getByRole('button', { name: 'Convidar pessoa' }).click();
  const inv = page.getByRole('dialog', { name: 'Convidar pessoa' });
  await inv.getByLabel('Nome').fill('Vendedora E2E');
  await inv.getByLabel('E-mail').fill(sellerEmail);
  await inv.getByRole('button', { name: 'Enviar convite' }).click();
  await expect(page.getByRole('cell', { name: sellerEmail })).toBeVisible();

  const ctx = await browser.newContext();
  const seller = await ctx.newPage();
  await login(seller, sellerEmail);
  await expect(seller.getByRole('link', { name: 'Configurações' })).toHaveCount(0);
  await expect(seller.getByRole('link', { name: 'Fornecedores' })).toHaveCount(0);
  await seller.goto('/app/estoque');
  await expect(seller.getByRole('button', { name: 'Novo produto' })).toHaveCount(0);
  await seller.getByRole('link', { name }).click();
  await expect(seller.locator('.stat').filter({ hasText: 'Disponível' })).toContainText('3');
  await expect(seller.locator('dl.kv').getByText('R$ 12.900,00')).toBeVisible();
  await expect(seller.getByText('8.123,45')).toHaveCount(0);
  await expect(seller.getByRole('button', { name: 'Registrar entrada' })).toHaveCount(0);
  await expect(seller.getByRole('heading', { name: 'Movimentos' })).toHaveCount(0);
  // Acesso direto à rota de administração volta para a visão geral; a API também nega.
  await seller.goto('/app/configuracoes');
  await expect(seller).toHaveURL(/\/app$/);
  await ctx.close();
});
