import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import './styles.css';
import './theme';
import { SessionProvider, useSession } from './session';
import { Shell } from './components/Shell';
import { Loading, ToastProvider } from './components/ui';
import { LoginPage } from './pages/Auth';
import { BirthdaysPage, ContactDetailPage, ContactsPage, SuppliersPage } from './pages/Contacts';
import { PipelinePage } from './pages/Pipeline';
import { InventoryPage, ProductDetailPage } from './pages/Inventory';
import { HomePage, SettingsPage } from './pages/Home';
import { FiscalDocumentPage, FiscalListPage } from './pages/Fiscal';
import { CommissionsPage } from './pages/Commissions';
import { FinancePage } from './pages/Finance';
import { AIResultsPage, VisitsPage } from './pages/AI';
import { OrderPage, QuoteEditorPage, QuotePage, SalesPage } from './pages/Sales';

function RequireSession({ children, permission }: { children: ReactNode; permission?: string }) {
  const { session, loading, can } = useSession();
  const loc = useLocation();
  if (loading) return <div className="login-wrap"><div style={{ width: 320 }}><Loading /></div></div>;
  if (!session) return <Navigate to="/app/entrar" replace state={{ from: loc.pathname }} />;
  if (permission && !can(permission)) return <Navigate to="/app" replace />;
  return <>{children}</>;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <SessionProvider>
        <ToastProvider>
          <Routes>
            <Route path="/" element={<Navigate to="/app" replace />} />
            <Route path="/app/entrar" element={<LoginPage />} />
            <Route path="/app" element={<RequireSession><Shell /></RequireSession>}>
              <Route index element={<HomePage />} />
              <Route path="pipeline" element={<PipelinePage />} />
              <Route path="contatos" element={<ContactsPage />} />
              <Route path="contatos/:id" element={<ContactDetailPage />} />
              <Route path="aniversariantes" element={<BirthdaysPage />} />
              <Route path="vendas" element={<SalesPage />} />
              <Route path="vendas/:id" element={<OrderPage />} />
              <Route path="comissoes" element={<CommissionsPage />} />
              <Route path="notas" element={<FiscalListPage />} />
              <Route path="notas/:id" element={<FiscalDocumentPage />} />
              <Route path="propostas/nova" element={<QuoteEditorPage />} />
              <Route path="propostas/:id" element={<QuotePage />} />
              <Route path="propostas/:id/editar" element={<QuoteEditorPage />} />
              <Route path="estoque" element={<InventoryPage />} />
              <Route path="estoque/:id" element={<ProductDetailPage />} />
              <Route path="fornecedores" element={<RequireSession permission="suppliers.read"><SuppliersPage /></RequireSession>} />
              <Route path="visitas" element={<VisitsPage />} />
              <Route path="ia" element={<RequireSession permission="finance.manage"><AIResultsPage /></RequireSession>} />
              <Route path="financeiro" element={<RequireSession permission="finance.manage"><FinancePage /></RequireSession>} />
              <Route path="configuracoes" element={<RequireSession permission="users.manage"><SettingsPage /></RequireSession>} />
            </Route>
            <Route path="*" element={<Navigate to="/app" replace />} />
          </Routes>
        </ToastProvider>
      </SessionProvider>
    </BrowserRouter>
  </StrictMode>,
);
