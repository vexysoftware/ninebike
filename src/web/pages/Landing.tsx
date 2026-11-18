import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { HttpError, api, describeError, fieldOf } from '../api';
import { Field } from '../components/ui';

/** Captura pública: só nome e celular. submission_id estável por envio evita lead duplicado em reenvio. */
export function LandingPage() {
  const submission = useRef(crypto.randomUUID());
  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle');
  const [error, setError] = useState<unknown>(null);
  useEffect(() => { document.title = 'Ninebike · Bikes que levam você mais longe'; }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setState('busy');
    setError(null);
    const utm = Object.fromEntries(['source', 'medium', 'campaign', 'content', 'term']
      .map((k) => [k, new URLSearchParams(location.search).get(`utm_${k}`)]).filter(([, v]) => v));
    try {
      await api.publicPost('/public/v1/lead-submissions', { submission_id: submission.current, name, mobile_phone: mobile,
        ...(Object.keys(utm).length ? { utm } : {}) });
      setState('done');
    } catch (err) {
      setError(err);
      setState('idle');
    }
  }
  const fe = (f: string) => (fieldOf(error) === f ? describeError(error) : null);

  return (
    <div className="landing">
      <section className="landing-hero">
        <div className="brand" style={{ padding: 0 }}><img src="/favicon.svg" alt="" className="brand-mark" /> Ninebike</div>
        <div style={{ display: 'grid', gap: 16 }}>
          <h1>A bike certa para o seu <em>próximo pedal.</em></h1>
          <p>Speed, MTB, urbanas e elétricas. Fale com um consultor da loja e receba uma indicação para o seu uso e orçamento.</p>
        </div>
        <Link to="/app" style={{ color: '#a5afa6', fontSize: 14 }}>Acesso da equipe</Link>
      </section>
      <section className="landing-form">
        {state === 'done' ? (
          <div className="card" role="status">
            <h2>Recebemos seu contato!</h2>
            <p className="muted" style={{ marginTop: 8 }}>Um consultor da Ninebike vai chamar você no WhatsApp em breve.</p>
          </div>
        ) : (
          <form onSubmit={submit} noValidate style={{ display: 'grid', gap: 16 }}>
            <h2>Quero falar com um consultor</h2>
            <Field label="Seu nome" error={fe('name')}>{(p) => <input {...p} className="input" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} required />}</Field>
            <Field label="Celular com DDD" help="Usaremos este número para falar com você pelo WhatsApp." error={fe('mobile_phone')}>
              {(p) => <input {...p} className="input" type="tel" inputMode="tel" autoComplete="tel" placeholder="(11) 98765-4321" value={mobile} onChange={(e) => setMobile(e.target.value)} required />}
            </Field>
            {error instanceof HttpError && !fieldOf(error) && <div className="alert alert-danger" role="alert">
              {error.code === 'CAPABILITY_UNAVAILABLE' ? 'O atendimento online está temporariamente indisponível. Fale com a loja pelo telefone.' : describeError(error)}</div>}
            <button className="btn btn-primary" disabled={state === 'busy'}>{state === 'busy' ? 'Enviando…' : 'Quero ser atendido'}</button>
            <p className="subtle">Seus dados são usados apenas para o atendimento comercial da Ninebike.</p>
          </form>
        )}
      </section>
    </div>
  );
}
