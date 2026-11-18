// Banco PostgreSQL real e isolado para os testes: recria do zero e aplica as migrations.
import postgres from 'postgres';
import { migrate } from '../../scripts/migrate.mjs';
import { ADMIN_URL } from './env';

export default async function setup() {
  await migrate({ url: ADMIN_URL, reset: true, log: () => {} });
  const sql = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
  await sql.unsafe(`alter role ninebike_api login password 'ninebike_api_test'`);
  await sql.end();
}
