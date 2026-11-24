// Portas para Supabase Storage (bucket privado) e Auth Admin (convites). Chave service_role só no servidor.
import { ApiError } from '../http/errors.js';

export interface FileStorage {
  createSignedUpload(bucket: string, path: string): Promise<{ upload_url: string; token: string }>;
  download(bucket: string, path: string): Promise<Uint8Array | null>;
  remove(bucket: string, path: string): Promise<void>;
  createSignedRead(bucket: string, path: string, expiresInSeconds: number): Promise<string>;
}

export interface AuthAdmin {
  inviteUser(email: string, name: string, redirectTo: string): Promise<void>;
}

export class SupabaseStorage implements FileStorage {
  constructor(private url: string, private serviceKey: string) {}
  private headers(extra: Record<string, string> = {}) {
    return { authorization: `Bearer ${this.serviceKey}`, apikey: this.serviceKey, ...extra };
  }
  async createSignedUpload(bucket: string, path: string) {
    const r = await fetch(`${this.url}/storage/v1/object/upload/sign/${bucket}/${path}`, { method: 'POST', headers: this.headers() });
    if (!r.ok) throw new ApiError('DEPENDENCY_UNAVAILABLE', { service: 'storage' });
    const j = (await r.json()) as { url: string };
    const token = new URL(j.url, 'https://x').searchParams.get('token') ?? '';
    return { upload_url: `${this.url}/storage/v1${j.url}`, token };
  }
  async download(bucket: string, path: string) {
    const r = await fetch(`${this.url}/storage/v1/object/authenticated/${bucket}/${path}`, { headers: this.headers() });
    if (r.status === 404 || r.status === 400) return null;
    if (!r.ok) throw new ApiError('DEPENDENCY_UNAVAILABLE', { service: 'storage' });
    return new Uint8Array(await r.arrayBuffer());
  }
  async remove(bucket: string, path: string) {
    await fetch(`${this.url}/storage/v1/object/${bucket}`, {
      method: 'DELETE', headers: this.headers({ 'content-type': 'application/json' }), body: JSON.stringify({ prefixes: [path] }),
    });
  }
  async createSignedRead(bucket: string, path: string, expiresIn: number) {
    const r = await fetch(`${this.url}/storage/v1/object/sign/${bucket}/${path}`, {
      method: 'POST', headers: this.headers({ 'content-type': 'application/json' }), body: JSON.stringify({ expiresIn }),
    });
    if (!r.ok) throw new ApiError('DEPENDENCY_UNAVAILABLE', { service: 'storage' });
    const j = (await r.json()) as { signedURL: string };
    return `${this.url}/storage/v1${j.signedURL}`;
  }
}

export class SupabaseAuthAdmin implements AuthAdmin {
  constructor(private url: string, private serviceKey: string) {}
  async inviteUser(email: string, name: string, redirectTo: string) {
    const r = await fetch(`${this.url}/auth/v1/invite?redirect_to=${encodeURIComponent(redirectTo)}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.serviceKey}`, apikey: this.serviceKey, 'content-type': 'application/json' },
      body: JSON.stringify({ email, data: { name } }),
    });
    if (!r.ok) throw new ApiError('DEPENDENCY_UNAVAILABLE', { service: 'auth', status: r.status });
  }
}

/** Confere os bytes reais da imagem (assinatura) — não confia no content-type declarado. */
export function sniffImage(bytes: Uint8Array): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length > 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => bytes[i] === b)) return 'image/png';
  if (bytes.length > 12 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP')
    return 'image/webp';
  return null;
}
