// Valida o JWT do Supabase Auth (assinatura, issuer, audiência, expiração) e deriva a prova de MFA recente.
// O vínculo/perfil atual é revalidado no banco a cada comando; o token sozinho não concede nada.
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { ApiError } from './errors';

export type AuthConfig = {
  issuer: string; // ex.: https://<projeto>.supabase.co/auth/v1
  audience: string; // "authenticated"
  jwksUrl?: string; // chaves assimétricas do projeto
  hs256Secret?: string; // segredo legado do projeto ou segredo local de desenvolvimento
};

export type Principal = { userId: string; sessionId: string | null; mfaRecent: boolean };

const MFA_WINDOW_SECONDS = 300;
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

type SupabaseClaims = JWTPayload & {
  aal?: string;
  session_id?: string;
  amr?: Array<{ method?: string; timestamp?: number }>;
  role?: string;
};

export async function authenticate(req: Request, cfg: AuthConfig, nowSeconds = Math.floor(Date.now() / 1000)): Promise<Principal> {
  const header = req.headers.get('authorization') ?? '';
  const m = /^Bearer ([A-Za-z0-9._-]+)$/.exec(header);
  if (!m) throw new ApiError('AUTH_REQUIRED');
  let payload: SupabaseClaims;
  try {
    const opts = { issuer: cfg.issuer, audience: cfg.audience, currentDate: new Date(nowSeconds * 1000) };
    if (cfg.jwksUrl) {
      let jwks = jwksCache.get(cfg.jwksUrl);
      if (!jwks) jwksCache.set(cfg.jwksUrl, (jwks = createRemoteJWKSet(new URL(cfg.jwksUrl))));
      try {
        payload = (await jwtVerify(m[1], jwks, opts)).payload as SupabaseClaims;
      } catch (e) {
        if (!cfg.hs256Secret) throw e;
        payload = (await jwtVerify(m[1], new TextEncoder().encode(cfg.hs256Secret), { ...opts, algorithms: ['HS256'] }))
          .payload as SupabaseClaims;
      }
    } else if (cfg.hs256Secret) {
      payload = (await jwtVerify(m[1], new TextEncoder().encode(cfg.hs256Secret), { ...opts, algorithms: ['HS256'] }))
        .payload as SupabaseClaims;
    } else {
      throw new ApiError('DEPENDENCY_UNAVAILABLE', { reason: 'auth_not_configured' });
    }
  } catch (e) {
    if (e instanceof ApiError) throw e;
    // Log sem o token: só o tipo do erro do jose (ex.: ERR_JWT_CLAIM_VALIDATION_FAILED "iss"), para diagnóstico.
    console.warn('auth: token rejeitado', (e as { code?: string }).code, (e as { claim?: string }).claim ?? '', cfg.issuer);
    throw new ApiError('AUTH_REQUIRED', { reason: 'invalid_token' });
  }
  if (!payload.sub || payload.role !== 'authenticated') throw new ApiError('AUTH_REQUIRED');
  return { userId: payload.sub, sessionId: payload.session_id ?? null, mfaRecent: hasRecentTotp(payload, nowSeconds) };
}

/** aal2 + entrada amr TOTP com 0 <= agora - timestamp <= 300 s. Horário futuro ou ausente falha fechado. */
export function hasRecentTotp(p: SupabaseClaims, nowSeconds: number): boolean {
  if (p.aal !== 'aal2' || !Array.isArray(p.amr)) return false;
  return p.amr.some((a) => {
    if (a?.method !== 'totp' || typeof a.timestamp !== 'number') return false;
    const age = nowSeconds - a.timestamp;
    return age >= 0 && age <= MFA_WINDOW_SECONDS;
  });
}
