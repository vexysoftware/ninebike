// Vercel Function (Node): /api/v1, /public/v1 e /agent/v1 chegam aqui por rewrite (vercel.json) com o caminho em __route.
import { createApp } from '../src/app';
import { buildDeps, type RuntimeEnv } from '../src/runtime';

export const config = { maxDuration: 30 };

async function handle(req: Request): Promise<Response> {
  const env = process.env as unknown as RuntimeEnv;
  const conn = env.DATABASE_URL;
  if (!conn) return Response.json({ code: 'DEPENDENCY_UNAVAILABLE', message: 'Banco não configurado.' }, { status: 503 });
  const url = new URL(req.url);
  const route = url.searchParams.get('__route');
  if (route) {
    if (!/^\/(api\/v1|public\/v1|agent\/v1)\//.test(route)) return new Response('Not found', { status: 404 });
    url.pathname = route;
    url.searchParams.delete('__route');
  }
  // Na Vercel o IP real vem em x-real-ip / x-forwarded-for; a app lê cf-connecting-ip (padronizado aqui, sobrescrevendo o do cliente).
  const headers = new Headers(req.headers);
  headers.delete('cf-connecting-ip');
  const ip = req.headers.get('x-real-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  if (ip) headers.set('cf-connecting-ip', ip);
  const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.arrayBuffer();
  const inner = new Request(url, { method: req.method, headers, body });
  const { deps, close } = buildDeps({ ...env, ENVIRONMENT: env.ENVIRONMENT ?? 'production' }, conn);
  try {
    return await createApp(deps)(inner);
  } finally {
    await close();
  }
}

export default { fetch: handle };
