import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, devAuth, setDevToken, setOnAuthLost, supabase } from './api';

export type Session = {
  user_id: string; name: string; email: string | null; profile: 'SELLER' | 'OWNER'; scope: 'STORE' | 'ASSIGNED';
  permissions: string[]; mfa_recent: boolean;
};
type Ctx = { session: Session | null; loading: boolean; reload: () => Promise<void>; signOut: () => Promise<void>; can: (p: string) => boolean };
const SessionContext = createContext<Ctx>(null as never);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    try {
      setSession(await api.get<Session>('/api/v1/session'));
    } catch {
      setSession(null);
    } finally {
      setLoading(false);
    }
  }, []);
  const signOut = useCallback(async () => {
    if (supabase) await supabase.auth.signOut();
    setDevToken(null);
    setSession(null);
  }, []);
  useEffect(() => {
    setOnAuthLost(() => setSession(null));
    void reload();
    const sub = supabase?.auth.onAuthStateChange(() => void reload());
    return () => sub?.data.subscription.unsubscribe();
  }, [reload]);
  const can = useCallback((p: string) => !!session?.permissions.includes(p), [session]);
  return <SessionContext.Provider value={{ session, loading, reload, signOut, can }}>{children}</SessionContext.Provider>;
}

export const useSession = () => useContext(SessionContext);
export const isDevAuth = devAuth;
