import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { HttpError, api, describeError, newKey } from '../api';
import { useSession } from '../session';
import { Icon, useToast } from './ui';
import { applyTheme, getThemePref, type ThemePref } from '../theme';

export function Shell() {
  const { session, signOut, can } = useSession();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);
  const isOwner = session?.profile === 'OWNER';
  return (
    <div className="shell" data-nav-open={open}>
      {open && <div className="scrim" onClick={() => setOpen(false)} />}
      <aside className="sidebar" aria-label="Navegação principal">
        <div className="brand"><img src="/favicon.svg" alt="" className="brand-mark" /> Ninebike</div>
        <nav className="nav">
          <NavLink to="/app" end><Icon name="home" /> Visão geral</NavLink>
          <div className="nav-section">Comercial</div>
          <NavLink to="/app/pipeline"><Icon name="kanban" /> Pipeline</NavLink>
          <NavLink to="/app/visitas"><Icon name="calendar" /> Visitas</NavLink>
          <NavLink to="/app/contatos"><Icon name="users" /> Contatos</NavLink>
          <NavLink to="/app/vendas"><Icon name="list" /> Registro de vendas</NavLink>
          <NavLink to="/app/comissoes"><Icon name="users" /> Comissões</NavLink>
          <NavLink to="/app/notas"><Icon name="check" /> Notas fiscais</NavLink>
          <NavLink to="/app/aniversariantes"><Icon name="cake" /> Aniversariantes</NavLink>
          <div className="nav-section">Loja</div>
          <NavLink to="/app/estoque"><Icon name="bike" /> Catálogo e estoque</NavLink>
          {can('suppliers.read') && <NavLink to="/app/fornecedores"><Icon name="truck" /> Fornecedores</NavLink>}
          {isOwner && <><div className="nav-section">Administração</div>
            <NavLink to="/app/importar"><Icon name="arrowUp" /> Importar contatos</NavLink>
            <NavLink to="/app/ia"><Icon name="spark" /> Resultados da IA</NavLink>
            <NavLink to="/app/financeiro"><Icon name="list" /> Financeiro</NavLink>
            <NavLink to="/app/configuracoes"><Icon name="settings" /> Configurações</NavLink></>}
        </nav>
        <div className="sidebar-foot">
          <div style={{ fontWeight: 600 }}>{session?.name}</div>
          <div className="subtle">{isOwner ? 'Proprietário' : 'Vendedor'}</div>
          <button className="btn btn-ghost btn-sm" style={{ marginTop: 8, paddingLeft: 0 }} onClick={() => void signOut()}>
            <Icon name="logout" /> Sair
          </button>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <button className="btn btn-ghost icon-btn menu-toggle" aria-label="Abrir menu" onClick={() => setOpen(true)}><Icon name="menu" /></button>
          <div className="spacer" />
          <EnvBadge />
          <ThemeToggle />
        </header>
        <main className="content" id="conteudo"><Outlet /></main>
      </div>
    </div>
  );
}

function EnvBadge() {
  const host = window.location.hostname;
  if (host === 'localhost' || host === '127.0.0.1') return <span className="env-badge">Ambiente local · dados de teste</span>;
  if (host.includes('staging')) return <span className="env-badge">Homologação</span>;
  return null;
}

export function ThemeToggle() {
  const [pref, setPref] = useState<ThemePref>(getThemePref());
  const next: Record<ThemePref, ThemePref> = { dark: 'light', light: 'system', system: 'dark' };
  const label = { system: 'Tema: Sistema', light: 'Tema: Claro', dark: 'Tema: Escuro' }[pref];
  return (
    <button className="btn btn-ghost btn-sm" onClick={() => { const n = next[pref]; applyTheme(n); setPref(n); }} aria-label={`${label}. Alternar tema`}>
      <Icon name={pref === 'dark' ? 'moon' : 'sun'} /> <span>{label.replace('Tema: ', '')}</span>
    </button>
  );
}

export function PageHead({ title, subtitle, children }: { title: string; subtitle?: string; children?: ReactNode }) {
  useEffect(() => { document.title = `${title} · Ninebike`; }, [title]);
  return (
    <div className="page-head">
      <div className="grow"><h1>{title}</h1></div>
      {children}
    </div>
  );
}

/** Comando com chave de idempotência estável por intenção; nova chave só após sucesso. */
export function useCommand() {
  const key = useRef(newKey());
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function run<T>(method: 'POST' | 'PATCH', path: string, body: unknown, opts: { success?: string; onError?: (e: unknown) => void; quiet?: boolean } = {}): Promise<T | null> {
    setBusy(true);
    setError(null);
    try {
      const r = await api.send<T>(method, path, body, key.current);
      key.current = newKey();
      if (opts.success) toast(opts.success);
      return r;
    } catch (e) {
      if (e instanceof HttpError && e.code === 'IDEMPOTENCY_CONFLICT') key.current = newKey();
      setError(e);
      opts.onError?.(e);
      if (!opts.quiet && !(e instanceof HttpError && e.code === 'VALIDATION_FAILED')) toast(describeError(e), 'error');
      return null;
    } finally {
      setBusy(false);
    }
  }
  return { run, busy, error, setError, reset: () => { key.current = newKey(); setError(null); } };
}
