// SOMENTE ENVIRONMENT=local: emite JWT de desenvolvimento assinado com DEV_JWT_SECRET para uma pessoa já
// convidada/cadastrada no banco local. Em qualquer outro ambiente a rota responde 404 (ver app.ts).
// No primeiro uso local, sem nenhum OWNER, a primeira pessoa vira OWNER para permitir convidar as demais.
import { SignJWT } from 'jose';
import type { Sql } from '../adapters/persistence/db.js';

export function makeDevLogin(adminSql: Sql, secret: string, issuer: string) {
  return async (email: string) => {
    const id = await adminSql.begin(async (tx) => {
      let [u] = await tx`select id from auth.users where lower(email) = ${email}`;
      if (!u) {
        const [{ owners }] = await tx`select count(*)::int as owners from identity.user_roles where role = 'OWNER'`;
        const [{ pending }] = await tx`select count(*)::int as pending from identity.invitations where email = ${email} and state = 'PENDING'`;
        if (owners > 0 && pending === 0) return null;
        [u] = await tx`insert into auth.users (email) values (${email}) returning id`;
        if (owners === 0) {
          await tx`insert into identity.profiles (id, name, email) values (${u.id}, ${email.split('@')[0]}, ${email})`;
          await tx`insert into identity.user_roles (user_id, role) values (${u.id}, 'OWNER')`;
        }
      }
      const [p] = await tx`select 1 from identity.profiles where id = ${u.id}`;
      return p ? (u.id as string) : null;
    });
    if (!id) return null;
    const now = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({ role: 'authenticated', aal: 'aal2', session_id: crypto.randomUUID(), email,
      amr: [{ method: 'totp', timestamp: now }] })
      .setProtectedHeader({ alg: 'HS256' }).setSubject(id).setIssuer(issuer).setAudience('authenticated')
      .setIssuedAt(now).setExpirationTime(now + 3600).sign(new TextEncoder().encode(secret));
    return { access_token: token };
  };
}
