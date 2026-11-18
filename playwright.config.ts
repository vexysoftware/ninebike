import { defineConfig } from '@playwright/test';

// Jornadas contra o Worker local (wrangler dev servindo SPA + API) e PostgreSQL local com dados sintéticos.
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  use: { baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:8787', trace: 'off', locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' },
});
