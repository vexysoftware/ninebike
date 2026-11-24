// Ferramentas de venda: oferta pronta para WhatsApp com simulador de parcelas e clientes esfriando.
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { Empty, Field, Icon, Loading, Status, formatCents, formatPhone, useLoad, useToast, waLink } from '../components/ui';

const brl = (cents: number) => formatCents(String(Math.round(cents)));

/** Oferta: preço à vista no Pix com desconto opcional e parcelas sem juros, pronta para copiar ou abrir no WhatsApp. */
export function OfferCard({ name, priceCents, available, color, size, brand }: { name: string; priceCents: string | null; available: number | null;
  color?: string | null; size?: string | null; brand?: string | null }) {
  const toast = useToast();
  const [pix, setPix] = useState('5');
  const [n, setN] = useState(10);
  const [phone, setPhone] = useState('');
  const price = Number(priceCents ?? 0);
  const pixPrice = price * (1 - (Number(pix.replace(',', '.')) || 0) / 100);
  const msg = useMemo(() => [
    `*${name}*${brand ? ` · ${brand}` : ''}`,
    [color, size].filter(Boolean).join(' · '),
    '',
    `💰 ${brl(price)} em até *${n}x de ${brl(price / n)}* sem juros`,
    Number(pix) > 0 ? `⚡ À vista no Pix: *${brl(pixPrice)}* (${pix}% off)` : '',
    available != null && available > 0 && available <= 2 ? `🔥 Últimas ${available} unidade(s) em estoque` : available ? '✅ Pronta entrega' : '',
    '',
    'Quer agendar um test ride? 🚲⚡',
  ].filter((l, i, a) => l !== '' || (a[i - 1] !== '' && i > 0)).join('\n').trim(), [name, brand, color, size, price, n, pix, pixPrice, available]);
  if (!priceCents) return null;
  const digits = phone.replace(/\D/g, '');
  const to = digits.length >= 10 ? (digits.startsWith('55') ? digits : `55${digits}`) : '';
  return (
    <section className="card">
      <div className="card-head"><h2>Oferta para WhatsApp</h2></div>
      <div className="form-grid" style={{ marginBottom: 12 }}>
        <Field label="Desconto Pix (%)">{(p) => <input {...p} className="input" inputMode="decimal" value={pix} onChange={(e) => setPix(e.target.value)} />}</Field>
        <Field label="Parcelas">{(p) => (
          <select {...p} className="input" value={n} onChange={(e) => setN(Number(e.target.value))}>
            {[1, 2, 3, 4, 5, 6, 10, 12, 18].map((x) => <option key={x} value={x}>{x}x de {brl(price / x)}</option>)}
          </select>)}</Field>
        <Field label="Celular do cliente" optional>{(p) => <input {...p} className="input" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(11) 99999-9999" />}</Field>
      </div>
      <pre className="offer-preview">{msg}</pre>
      <div className="unit-row" style={{ marginTop: 12 }}>
        <button className="btn" onClick={() => { void navigator.clipboard?.writeText(msg); toast('Mensagem copiada.'); }}>Copiar</button>
        <a className="btn btn-primary" target="_blank" rel="noreferrer" href={`https://wa.me/${to}?text=${encodeURIComponent(msg)}`}>
          <Icon name="send" /> Abrir no WhatsApp</a>
      </div>
    </section>
  );
}

type Followup = { opportunity_id: string; contact_id: string; name: string; mobile_phone: string | null; stage: string; seller_name: string;
  interest: string | null; days: number };

/** Clientes sem toque há N dias, com mensagem de retomada em um clique. */
export function FollowupsCard() {
  const [days, setDays] = useState(3);
  const [all, setAll] = useState(false);
  const f = useLoad(() => api.get<Followup[]>(`/api/v1/followups?days=${days}`), [days]);
  const nudge = (x: Followup) => {
    const first = x.name.split(' ')[0];
    return `Oi ${first}, tudo bem? ${x.interest ? `Ainda pensando na ${x.interest}? ` : ''}Separei uma condição especial pra você essa semana. Posso te mandar? 🚲⚡`;
  };
  return (
    <section className="card">
      <div className="card-head"><h2>Clientes esfriando</h2>
        <select className="input" style={{ width: 'auto' }} aria-label="Sem contato há" value={days} onChange={(e) => setDays(Number(e.target.value))}>
          {[2, 3, 7, 15, 30].map((d) => <option key={d} value={d}>+{d} dias</option>)}
        </select></div>
      {f.loading ? <Loading /> : !f.data?.length ? <Empty title="Ninguém esfriando. 👏" /> : (
        <><ul className="timeline">{(all ? f.data : f.data.slice(0, 6)).map((x) => (
          <li key={x.opportunity_id}><span className="dot" />
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', width: '100%', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 160 }}>
                <Link to={`/app/pipeline?abrir=${x.opportunity_id}`}>{x.name}</Link>{' '}
                <Status tone={x.days >= 7 ? 'danger' : 'warn'}>{x.days} dia(s)</Status>
                <div className="subtle">{x.stage}{x.interest ? ` · ${x.interest}` : ''} · {x.seller_name}</div>
              </div>
              {x.mobile_phone && <a className="btn btn-sm" target="_blank" rel="noreferrer" title={formatPhone(x.mobile_phone)}
                href={`${waLink(x.mobile_phone)}?text=${encodeURIComponent(nudge(x))}`}>Chamar</a>}
            </div></li>))}</ul>
        {f.data.length > 6 && <button className="btn btn-ghost btn-sm" onClick={() => setAll(!all)}>{all ? 'Mostrar menos' : `Ver todos (${f.data.length})`}</button>}</>)}
    </section>
  );
}
