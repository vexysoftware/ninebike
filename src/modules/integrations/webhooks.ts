// Entrega da fila de eventos (outbox) aos webhooks cadastrados, com assinatura HMAC-SHA256.
// Cabeçalhos: X-Ninebike-Event, X-Ninebike-Delivery (id estável p/ deduplicar), X-Ninebike-Timestamp,
// X-Ninebike-Signature: sha256=<hex de HMAC(secret, `${timestamp}.${body}`)>.
import type { Db } from '../../adapters/persistence/db';

type Item = { id: string; url: string; secret: string; event: string; payload: unknown; attempts: number };

/** Bloqueia destinos internos (SSRF): só https, sem IP literal privado/loopback, sem localhost. */
export function isSafeWebhookUrl(raw: string): boolean {
  let u: URL;
  try { u = new URL(raw); } catch { return false; }
  if (u.protocol !== 'https:' || u.username || u.password) return false;
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return false;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) {
    const [a, b] = h.split('.').map(Number);
    if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)) return false;
  }
  if (h.includes(':')) return false; // IPv6 literal: não aceito
  return true;
}

export async function sign(secret: string, timestamp: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${body}`));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function deliverOutbox(db: Db, fetcher: typeof fetch = fetch, limit = 25): Promise<{ sent: number; failed: number }> {
  const items = await db.query<Item[]>('job_outbox_claim', [limit]);
  let sent = 0, failed = 0;
  for (const it of items) {
    let ok = false, err: string | null = null;
    if (!isSafeWebhookUrl(it.url)) err = 'url_not_allowed';
    else {
      const body = JSON.stringify({ delivery_id: it.id, ...(it.payload as object) });
      const ts = String(Math.floor(Date.now() / 1000));
      try {
        const r = await fetcher(it.url, {
          method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(10_000),
          headers: { 'content-type': 'application/json', 'user-agent': 'Ninebike-Webhooks/1', 'x-ninebike-event': it.event,
            'x-ninebike-delivery': it.id, 'x-ninebike-timestamp': ts, 'x-ninebike-signature': `sha256=${await sign(it.secret, ts, body)}` },
          body,
        });
        ok = r.status >= 200 && r.status < 300;
        if (!ok) err = `http_${r.status}`;
      } catch (e) {
        err = (e as Error)?.name === 'TimeoutError' ? 'timeout' : 'network_error';
      }
    }
    await db.query('job_outbox_result', [it.id, ok, err]);
    if (ok) sent++; else failed++;
  }
  return { sent, failed };
}
