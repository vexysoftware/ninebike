# Deploy na Vercel + Supabase

O projeto já vem preparado para a Vercel:
- `vercel.json` define o build, as rotas, os cabeçalhos de segurança e o cron;
- `api/server.ts` atende a API;
- `api/cron.ts` roda a manutenção;
- `scripts/deploy-db.mjs` aplica as migrations a cada build.

## 1. Supabase (uma vez)

1. Em **Authentication → Sign In / Providers**, desligue **Allow new users to sign up**. O acesso é só por convite.
2. Em **Authentication → Sign In / Providers → Email**, mantenha o e-mail ligado. O MFA (TOTP) já vem disponível.
3. Em **Authentication → URL Configuration**, coloque o domínio da Vercel em **Site URL** e em **Redirect URLs** (`https://SEU-DOMINIO/app`).

## 2. Variáveis na Vercel (Settings → Environment Variables)

A integração Supabase↔Vercel já cria estas: `POSTGRES_URL`, `POSTGRES_URL_NON_POOLING`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

Acrescente estas:

| Nome | Valor |
| --- | --- |
| `NINEBIKE_API_DB_PASSWORD` | Senha forte (24+ caracteres). Por exemplo, gere com `openssl rand -base64 32`. É a senha do papel restrito do backend. |
| `CRON_SECRET` | Outra senha aleatória. Protege a rota de manutenção. |
| `NINEBIKE_OWNER_EMAIL` | E-mail do dono da loja (primeiro proprietário). |
| `NINEBIKE_OWNER_NAME` | Nome do dono. |

## 3. Deploy

1. Faça o push para o GitHub. A Vercel faz o build e as migrations rodam sozinhas no início; o log mostra `[db] aplicada …`.
2. O branch de produção é o configurado na Vercel, normalmente `main`. Os outros branches geram deploy de prévia.

## 4. Primeiro acesso

1. No Supabase, em **Authentication → Users → Invite user**, convide o e-mail de `NINEBIKE_OWNER_EMAIL`. Ao aceitar, a pessoa vira proprietária automaticamente. Se ela já existia no Auth, isso aconteceu no deploy.
2. Entre em `https://SEU-DOMINIO/app/entrar` e ative o segundo fator em **Configurações**.
3. Daí em diante, convide os vendedores pelo próprio sistema.

## 5. Observações

- **Cron:** no plano Hobby da Vercel, o cron roda uma vez por dia (06:17 UTC). Os webhooks também saem logo depois de cada ação. Para manutenção a cada 5 minutos, use o plano Pro e troque `schedule` em `vercel.json` para `*/5 * * * *`.
- **Banco:** o backend conecta como `ninebike_api` pelo pooler (porta 6543), só com acesso às funções `api.*`. O navegador nunca acessa tabelas.
- **Login local de desenvolvimento:** fica desligado na Vercel, porque `ENVIRONMENT` só é `local` em máquina de desenvolvimento.
