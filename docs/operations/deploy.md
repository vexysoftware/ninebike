# Implantação — staging e produção

Nada abaixo foi executado ainda: não há projeto Supabase, Hyperdrive ou domínio provisionado. Cada passo precisa ser feito por quem tem acesso às contas, separadamente para **staging** e **produção** (projetos e credenciais diferentes; nunca clonar produção em preview).

## 1. Supabase (por ambiente)

1. Criar o projeto. Em *Authentication → Providers*, desligar cadastro público (signup) — acesso é só por convite.
2. Aplicar as migrations: `supabase link --project-ref <ref>` e `supabase db push`. Não usar `scripts/migrate.mjs` (é só local/teste e aplica um shim de `auth`).
3. Dar login ao papel do backend (senha forte, guardada no cofre):
   ```sql
   alter role ninebike_api login password '<senha>';
   ```
4. Criar o bucket **privado** `ninebike-private` em Storage (sem políticas públicas).
5. Convidar o primeiro dono pelo painel (Authentication → Invite) e rodar uma única vez:
   `DATABASE_URL=<conexão administrativa> node scripts/bootstrap-owner.mjs dono@empresa.com.br "Nome"`.
   Os demais entram por **Configurações → Convidar pessoa**.
6. No primeiro acesso, o dono ativa o segundo fator (TOTP) em Configurações; convites e troca de perfil exigem TOTP recente.

## 2. Cloudflare Worker

1. Criar Hyperdrive apontando para o Postgres do projeto **com o usuário `ninebike_api`** e colocar o ID em `wrangler.jsonc` (`env.staging` / `env.production`). Ajustar `APP_ORIGIN`.
2. Secrets (nunca no Git):
   ```bash
   npx wrangler secret put SUPABASE_URL --env staging
   npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY --env staging
   npx wrangler secret put SUPABASE_JWT_SECRET --env staging   # só se o projeto ainda usar segredo HS256
   ```
3. Frontend: `.env.production` (ou variáveis do build) com `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` — apenas valores publicáveis.
4. `npm ci && npm run build && npx wrangler deploy --env staging`.
5. Smoke: login, MFA, sessão, contato, pipeline, produto, negação de rota OWNER com conta SELLER.

## 3. Ordem de release (build-guide §12)

validar instalação limpa/upgrade em CI → migrar staging → jornadas → conferir backup de produção → migration compatível → publicar o mesmo artefato → smoke do recorte. Rollback de código só com schema compatível; nunca down migration destrutiva.

## 4. Rotação/desligamento

- Senha do `ninebike_api`: alterar no Postgres e no Hyperdrive.
- `SUPABASE_SERVICE_ROLE_KEY`: rotacionar no painel e repetir `wrangler secret put`.
- Desligar captura pública: Configurações → Leads do site → “Ninguém”.
