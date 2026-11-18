// Jornada T02: lead sem CPF → oportunidade → movimento no pipeline sem gerar pagamento; ordem persiste após recarregar.
import { expect, test } from '@playwright/test';
import { login, mobile, uniq } from './helpers';

test('lead sem CPF vira oportunidade e muda de etapa pelo menu acessível', async ({ page }) => {
  await login(page, 'dono@ninebike.local');
  const name = `Lead E2E ${uniq()}`;
  await page.goto('/app/pipeline');
  await page.getByRole('button', { name: 'Novo lead' }).click();
  const dlg = page.getByRole('dialog', { name: 'Novo contato' });
  await dlg.getByLabel('Nome').fill(name);
  await dlg.getByLabel('Celular').fill(mobile());
  await dlg.getByRole('button', { name: 'Salvar contato' }).click();
  await expect(page.getByRole('dialog', { name })).toBeVisible();
  await page.getByRole('dialog', { name }).getByRole('button', { name: 'Fechar' }).click();

  const novo = page.getByRole('region', { name: 'Novo' });
  await expect(novo.getByRole('link', { name })).toBeVisible();
  await novo.getByRole('button', { name: `Mover ${name} para…` }).click();
  const mv = page.getByRole('dialog', { name: `Mover “${name}”` });
  await mv.getByLabel('Etapa').selectOption({ label: 'Qualificação' });
  await mv.getByRole('button', { name: 'Mover' }).click();
  await expect(page.getByRole('region', { name: 'Qualificação' }).getByRole('link', { name })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('region', { name: 'Qualificação' }).getByRole('link', { name })).toBeVisible();

  // Perdido exige motivo
  await page.getByRole('region', { name: 'Qualificação' }).getByRole('button', { name: `Mover ${name} para…` }).click();
  await page.getByRole('dialog', { name: `Mover “${name}”` }).getByLabel('Etapa').selectOption({ label: 'Perdido' });
  await page.getByRole('dialog', { name: `Mover “${name}”` }).getByRole('button', { name: 'Mover' }).click();
  const loss = page.getByRole('dialog', { name: 'Motivo da perda' });
  await loss.getByLabel('Motivo').fill('Preço acima do orçamento');
  await loss.getByRole('button', { name: 'Registrar perda' }).click();
  await expect(page.getByRole('region', { name: 'Perdido' }).getByRole('link', { name })).toBeVisible();
});

test('cadastro: CPF inválido mostra erro no campo; observação opcional', async ({ page }) => {
  await login(page, 'dono@ninebike.local');
  await page.goto('/app/contatos');
  await page.getByRole('button', { name: 'Novo contato' }).click();
  const dlg = page.getByRole('dialog', { name: 'Novo contato' });
  await dlg.getByLabel('Nome').fill(`Cliente ${uniq()}`);
  await dlg.getByLabel('Celular').fill(mobile());
  await dlg.getByText('Mais dados (opcionais)').click();
  await dlg.getByLabel(/CPF/).fill('111.222.333-00');
  await dlg.getByRole('button', { name: 'Salvar contato' }).click();
  await expect(dlg.getByRole('alert')).toContainText('CPF é inválido');
});

test('arraste por teclado reordena dentro da etapa e persiste', async ({ page }) => {
  await login(page, 'dono@ninebike.local');
  const a = `Ordem ${uniq()}`; const b = `Ordem ${uniq()}`;
  for (const n of [a, b]) {
    await page.goto('/app/pipeline');
    await page.getByRole('button', { name: 'Novo lead' }).click();
    const dlg = page.getByRole('dialog', { name: 'Novo contato' });
    await dlg.getByLabel('Nome').fill(n);
    await dlg.getByLabel('Celular').fill(mobile());
    await dlg.getByRole('button', { name: 'Salvar contato' }).click();
    await page.getByRole('dialog', { name: n }).getByRole('button', { name: 'Fechar' }).click();
  }
  const col = page.getByRole('region', { name: 'Novo' });
  const titles = async () => (await col.locator('.opp-card .title').allInnerTexts()).filter((t) => t === a || t === b);
  expect(await titles()).toEqual([a, b]);
  await page.waitForLoadState('networkidle');
  const handle = col.getByRole('button', { name: `Arrastar ${b}` });
  await handle.focus();
  await expect(handle).toBeFocused();
  await page.waitForTimeout(300);
  // O sensor de teclado do dnd-kit anima entre passos; aguardar o anúncio de cada etapa.
  await page.keyboard.press('Space');
  await expect(page.locator('[id^=DndLiveRegion]')).toContainText(/Movendo|Sobre/);
  await page.keyboard.press('ArrowUp');
  await page.waitForTimeout(250);
  await page.keyboard.press('Space');
  await expect.poll(titles).toEqual([b, a]);
  await page.waitForResponse((r) => r.url().includes('/pipeline-stages') && r.request().method() === 'GET');
  await page.reload();
  await expect.poll(titles).toEqual([b, a]);
});
