# Ninebike OS

Sistema próprio da Ninebike (CRM, pipeline, catálogo/estoque; depois vendas, financeiro e fiscal com aprovação humana). Especificação em [`specs/`](specs/README.md) — o ponto de entrada é o [guia de construção](specs/001-sistema/build-guide.md). Estado real de cada tarefa: [`specs/001-sistema/progress.md`](specs/001-sistema/progress.md).

**Arquitetura:** monólito modular TypeScript num Cloudflare Worker (API `/api/v1` + SPA React/Vite), Supabase Auth/Postgres/Storage. Regras de integridade vivem em funções SQL do schema `api` (únicas executáveis pelo backend), com locks, versões e auditoria na mesma transação.

```
src/worker.ts                 entrada do Worker (API + assets)
src/app.ts                    rotas HTTP /api/v1 e /public/v1
src/adapters/http/            JWT, validação de payload fechado, erros do contrato
src/adapters/persistence/     chamadas às RPCs + recibos de idempotência
src/adapters/providers/       Supabase Storage e Auth Admin
src/modules/crm/              regras puras (celular, CPF/CNPJ, aniversário)
src/web/                      interface (tokens do design.md, temas claro/escuro)
supabase/migrations/          schema, RPCs, grants e RLS
tests/{unit,db,integration,e2e}
```

## Rodar localmente

Requisitos: Node 22 e PostgreSQL 16 local.

```bash
npm ci
cp .dev.vars.example .dev.vars        # ajuste a porta/senhas do seu Postgres
createdb ninebike && createdb ninebike_test
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:54329/ninebike npm run db:reset
psql -d ninebike -c "alter role ninebike_api login password 'ninebike_api_local'"
npm run build && npx wrangler dev --port 8787
```

Abra `http://127.0.0.1:8787/app/entrar`. Sem `VITE_SUPABASE_URL`, o login é de **desenvolvimento** (só e-mail, só em `ENVIRONMENT=local`); a primeira pessoa vira proprietária e as demais entram após convite em Configurações. A landing pública fica em `/`.

## Verificações

```bash
npm run typecheck
npm run build
npm run test:unit
npm run test:db            # PostgreSQL real (TEST_ADMIN_DATABASE_URL)
npm run test:integration
npm run test:e2e           # com o Worker rodando em :8787
```

Implantação em staging/produção: [`docs/operations/deploy.md`](docs/operations/deploy.md).
