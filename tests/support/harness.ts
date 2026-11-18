import postgres from 'postgres';
import { SignJWT } from 'jose';
import { createApp, type AppDeps } from '../../src/app';
import { Db } from '../../src/adapters/persistence/db';
import { ADMIN_URL, API_URL, ISSUER, JWT_SECRET } from './env';

export const admin = postgres(ADMIN_URL, { max: 4, onnotice: () => {} });
export const apiSql = postgres(API_URL, { max: 8, onnotice: () => {} });

export type TestUser = { id: string; email: string; role: 'SELLER' | 'OWNER'; token: string; tokenNoMfa: string };

let n = 0;
export async function makeUser(role: 'SELLER' | 'OWNER', name = `${role.toLowerCase()}-${++n}`): Promise<TestUser> {
  const email = `${name}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@teste.local`;
  const [u] = await admin`insert into auth.users (email) values (${email}) returning id`;
  await admin`insert into identity.profiles (id, name, email) values (${u.id}, ${name}, ${email})`;
  await admin`insert into identity.user_roles (user_id, role) values (${u.id}, ${role})`;
  return { id: u.id, email, role, token: await token(u.id, true), tokenNoMfa: await token(u.id, false) };
}

export async function token(sub: string, mfa: boolean, opts: { mfaAgeSeconds?: number; issuer?: string; expired?: boolean } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const claims: Record<string, unknown> = { role: 'authenticated', session_id: crypto.randomUUID(), aal: mfa ? 'aal2' : 'aal1' };
  if (mfa) claims.amr = [{ method: 'totp', timestamp: now - (opts.mfaAgeSeconds ?? 10) }];
  return new SignJWT(claims).setProtectedHeader({ alg: 'HS256' }).setSubject(sub).setIssuer(opts.issuer ?? ISSUER)
    .setAudience('authenticated').setIssuedAt(now - 20).setExpirationTime(opts.expired ? now - 10 : now + 600)
    .sign(new TextEncoder().encode(JWT_SECRET));
}

export function makeApp(overrides: Partial<AppDeps> = {}) {
  return createApp({
    db: new Db(apiSql), auth: { issuer: ISSUER, audience: 'authenticated', hs256Secret: JWT_SECRET },
    environment: 'test', deployId: 'test', storage: null, storageBucket: 'test', authAdmin: null,
    appOrigin: 'http://localhost', ...overrides,
  });
}

const app = makeApp();
export type Res = { status: number; body: any; headers: Headers };

export async function call(method: string, path: string, opts: { user?: TestUser; token?: string; body?: unknown; key?: string | null; handler?: (r: Request) => Promise<Response> } = {}): Promise<Res> {
  const headers: Record<string, string> = {};
  const t = opts.token ?? opts.user?.token;
  if (t) headers.authorization = `Bearer ${t}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET' && opts.key !== null) headers['idempotency-key'] = opts.key ?? crypto.randomUUID();
  const r = await (opts.handler ?? app)(new Request(`http://localhost${path}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) }));
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) : null, headers: r.headers };
}

export function randomCpf(): string {
  const d = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
  for (const len of [9, 10]) {
    let s = 0;
    for (let i = 0; i < len; i++) s += d[i] * (len + 1 - i);
    const r = (s * 10) % 11;
    d.push(r === 10 ? 0 : r);
  }
  return d.join('');
}
let phone = 10000000;
export const randomMobile = () => `(11) 9${String(++phone + Math.floor(Math.random() * 80000000)).padStart(8, '0').slice(0, 8)}`;
