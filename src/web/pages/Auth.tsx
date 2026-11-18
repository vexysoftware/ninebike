import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { api, describeError, setDevToken, supabase } from '../api';
import { isDevAuth, useSession } from '../session';
import { Dialog, Field } from '../components/ui';
import { ThemeToggle } from '../components/Shell';

export function LoginPage() {
  const { session, loading, reload } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'password' | 'mfa'>('password');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!loading && session) return <Navigate to="/app" replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (isDevAuth) {
        const r = await api.publicPost<{ access_token: string }>('/api/v1/dev/login', { email });
        setDevToken(r.access_token);
      } else if (step === 'password') {
        const { error: err } = await supabase!.auth.signInWithPassword({ email, password });
        if (err) throw new Error('E-mail ou senha incorretos.');
        const { data } = await supabase!.auth.mfa.getAuthenticatorAssuranceLevel();
        if (data?.nextLevel === 'aal2' && data.currentLevel !== 'aal2') {
          setStep('mfa');
          return;
        }
      } else {
        await verifyTotp(code);
      }
      await reload();
    } catch (err) {
      setError(err instanceof Error && !('code' in err) ? err.message : describeError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <div style={{ position: 'fixed', top: 12, right: 12 }}><ThemeToggle /></div>
      <form className="card login-card" onSubmit={submit} noValidate>
        <div className="brand" style={{ padding: 0 }}><img src="/favicon.svg" alt="" className="brand-mark" /> Ninebike</div>
        <h1>Entrar</h1>
        {isDevAuth && (
          <div className="alert alert-warn"><strong>Ambiente local de desenvolvimento</strong>
            Login por e-mail sem senha, somente neste computador. Em homologação/produção o acesso usa Supabase Auth com conta individual.</div>
        )}
        {step === 'password' ? (
          <>
            <Field label="E-mail">{(p) => <input {...p} className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />}</Field>
            {!isDevAuth && (
              <Field label="Senha">{(p) => <input {...p} className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />}</Field>
            )}
          </>
        ) : (
          <Field label="Código do aplicativo autenticador" help="6 dígitos do seu app (Google Authenticator, 1Password etc.).">
            {(p) => <input {...p} className="input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} autoFocus />}
          </Field>
        )}
        {error && <div className="alert alert-danger" role="alert">{error}</div>}
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Entrando…' : step === 'mfa' ? 'Confirmar código' : 'Entrar'}</button>
        <p className="subtle">O acesso é por convite. Peça ao proprietário da loja.</p>
      </form>
    </div>
  );
}

export async function verifyTotp(code: string) {
  if (!supabase) return;
  const { data } = await supabase.auth.mfa.listFactors();
  const factor = data?.totp.find((f) => f.status === 'verified');
  if (!factor) throw new Error('Nenhum segundo fator configurado. Ative em Configurações.');
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
  if (error) throw new Error('Código inválido ou expirado.');
}

/** Pede o TOTP de novo quando a API exige MFA recente (≤ 5 min) para um ato sensível. */
export function MfaPrompt({ open, onDone, onCancel }: { open: boolean; onDone: () => void; onCancel: () => void }) {
  const [code, setCode] = useState('');
  const [err, setErr] = useState<string | null>(null);
  return (
    <Dialog open={open} title="Confirme o segundo fator" onClose={onCancel}
      footer={<div className="form-actions"><button className="btn" onClick={onCancel}>Cancelar</button>
        <button className="btn btn-primary" onClick={async () => {
          try { await verifyTotp(code); setCode(''); onDone(); } catch (e) { setErr((e as Error).message); }
        }}>Confirmar</button></div>}>
      <p>Esta ação exige uma verificação recente do aplicativo autenticador.</p>
      <Field label="Código de 6 dígitos" error={err}>{(p) => <input {...p} className="input" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />}</Field>
    </Dialog>
  );
}
