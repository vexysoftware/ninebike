import { expect, type Page } from '@playwright/test';

export const uniq = () => Math.random().toString(36).slice(2, 7);
export const mobile = () => `(11) 9${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;

export async function login(page: Page, email: string) {
  await page.goto('/app/entrar');
  await page.getByLabel('E-mail').fill(email);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('navigation', { name: 'Navegação principal' }).or(page.getByRole('complementary'))).toBeVisible();
}
