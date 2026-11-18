// Promove a primeira pessoa a OWNER num projeto recém-criado (staging/produção), uma única vez.
// Pré-requisito: a pessoa já existe em auth.users (convidada pelo painel do Supabase).
// Uso: DATABASE_URL=<conexão administrativa> node scripts/bootstrap-owner.mjs dono@empresa.com.br "Nome do Dono"
import postgres from 'postgres';

const [email, name] = process.argv.slice(2);
if (!process.env.DATABASE_URL || !email || !name) {
  console.error('uso: DATABASE_URL=... node scripts/bootstrap-owner.mjs <email> "<nome>"');
  process.exit(1);
}
const sql = postgres(process.env.DATABASE_URL, { max: 1 });
try {
  await sql.begin(async (tx) => {
    const [{ owners }] = await tx`select count(*)::int owners from identity.user_roles where role = 'OWNER'`;
    if (owners > 0) throw new Error('Já existe OWNER. Use convites pela aplicação.');
    const [u] = await tx`select id from auth.users where lower(email) = ${email.toLowerCase()}`;
    if (!u) throw new Error('Usuário não encontrado em auth.users. Convide pelo painel do Supabase primeiro.');
    await tx`insert into identity.profiles (id, name, email) values (${u.id}, ${name}, ${email.toLowerCase()})`;
    await tx`insert into identity.user_roles (user_id, role) values (${u.id}, 'OWNER')`;
    await tx`insert into audit.audit_events (actor_kind, action, resource_type, resource_id, decision) values ('SYSTEM', 'bootstrap.owner', 'profile', ${u.id}, 'ALLOW')`;
  });
  console.log('OWNER inicial criado. Ative o segundo fator (TOTP) no primeiro acesso.');
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
