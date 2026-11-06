# FoodFinance

SaaS financeiro para restaurantes e negócios de alimentação. Next.js App Router, TypeScript, Tailwind CSS, Supabase Auth/PostgreSQL e Recharts.

## Desenvolvimento local

Requisitos: Node.js 20.9+ e npm.

```powershell
Copy-Item .env.example .env.local
npm install
npm run dev
```

Abra `http://localhost:3000`.

## Supabase

1. `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` apontam para o projeto. A URL é `https://<project-ref>.supabase.co`.
2. No SQL Editor do projeto, aplique em ordem `supabase/migrations/202611030001_initial_schema.sql` e `supabase/migrations/202611030002_kiwify_billing_access.sql`.
3. Configure `SUPABASE_SERVICE_ROLE_KEY` somente no ambiente server-side de produção. Nunca use uma service-role key em `NEXT_PUBLIC_*`, no navegador ou em commits.
4. Configure as opções de confirmação de e-mail em Authentication de acordo com o fluxo de produção.

RLS exige vínculo à empresa e assinatura ativa e não vencida para tabelas financeiras/operacionais. Cancelamento e inadimplência bloqueiam imediatamente; a exceção de desenvolvedor também é verificada no banco. O e-mail `gabrieldobkowski@gmail.com` é resolvido a partir de `auth.users`, sem papel configurável pelo navegador. Outros administradores de plataforma podem ser incluídos manualmente em `public.platform_admins` pelo SQL Editor.

A assinatura é da conta proprietária e vale para as empresas dessa conta; os dados continuam separados por empresa e associação. Não há período de avaliação grátis: o acesso é liberado somente após a confirmação de pagamento (rode `supabase/APLICAR_SEM_TRIAL.sql`).

## Kiwify

1. Publique o app em uma URL HTTPS estável. Cadastre `https://<dominio>/api/webhooks/kiwify` como webhook no painel Kiwify.
2. Configure os gatilhos `compra_aprovada`, `compra_reembolsada`, `chargeback`, `subscription_renewed`, `subscription_late` e `subscription_canceled`.
3. Defina um token longo no webhook e o mesmo valor em `KIWIFY_WEBHOOK_TOKEN`. A Kiwify envia `signature` na query; o endpoint valida HMAC-SHA1 no corpo bruto com comparação em tempo constante.
4. Em Apps > API na Kiwify, crie credenciais OAuth com acesso de leitura a vendas. Preencha `KIWIFY_CLIENT_ID`, `KIWIFY_CLIENT_SECRET` e `KIWIFY_ACCOUNT_ID` somente no ambiente server-side.
5. Mapeie IDs reais dos produtos para planos em `KIWIFY_PLAN_PRODUCTS`, separados por vírgula: `id-do-produto=bronze` (plano único).
6. `NEXT_PUBLIC_KIWIFY_CHECKOUT_URL` contém o link público de checkout (usado pelos botões de assinatura; se vazio, o app usa o link padrão do Plano Bronze). A pessoa deve criar/usar uma conta FoodFinance com o mesmo e-mail da compra.

O webhook é idempotente, registra hash e metadados do evento sem armazenar o corpo financeiro completo, e atualiza assinatura via RPC liberado apenas para `service_role`. Além da assinatura, compras/renovações são confirmadas em `GET /v1/sales/{order_id}` pela API OAuth da Kiwify, conferindo status pago, produto e e-mail. Eventos de teste com pedido inexistente não liberam acesso. Falhas temporárias da API retornam `503` para retry; pedidos reais não encontrados ou incompatíveis são ignorados sem conceder acesso.

A tabela de eventos não pode ser consultada por usuários autenticados. O checkout nunca altera entitlement por si só. O acesso é revogado após cancelamento, reembolso, chargeback, inadimplência ou vencimento; renovações pagas reativam o acesso pelo webhook.

## Acesso por assinatura

Quem não tem assinatura ativa consegue criar conta, entrar, gerenciar empresas e ver a tela de assinatura, mas os recursos (dashboard, movimentações, contas, estoque, fichas, fornecedores, relatórios e análises) ficam bloqueados com o aviso "Disponível somente com assinatura do plano". Os itens bloqueados aparecem com cadeado no menu. O bloqueio real continua no banco (RLS), não só na tela.

## Hospedagem (Vercel)

1. Suba o projeto para um repositório Git (o `.env.local` nunca vai junto) e importe na Vercel.
2. Em Settings > Environment Variables, cadastre todas as variáveis de `.env.example`. `SUPABASE_SERVICE_ROLE_KEY`, `KIWIFY_WEBHOOK_TOKEN`, `KIWIFY_CLIENT_ID`, `KIWIFY_CLIENT_SECRET` e `KIWIFY_ACCOUNT_ID` são secretas: só no servidor.
3. Aplique as migrations no Supabase (`supabase/APLICAR_NO_SUPABASE.sql` reúne tudo). Em Authentication > URL Configuration, coloque o domínio final em Site URL.
4. Faça o deploy, cadastre `https://<dominio>/api/webhooks/kiwify` na Kiwify e preencha `KIWIFY_PLAN_PRODUCTS` com o ID real do produto.

## Funcionalidades

- Cadastro, login, logout e solicitação de recuperação de senha via Supabase Auth.
- Empresas isoladas por RLS; criação inicial automática no cadastro.
- Vendas, despesas, contas a pagar/receber e atualização de liquidação.
- Produtos, estoque, fornecedores e fichas técnicas com custo/margem derivados dos registros.
- Dashboard mensal, gráficos semanais e por categoria, indicadores e exportação CSV.
- Dicas explicativas nos cards, gráficos e tabelas (passe o mouse no desktop ou toque no celular).
- Menu inferior e categorias dos gráficos arrastáveis com o dedo no celular.
- Verificação de entitlement no cliente a cada minuto, além da autorização obrigatória no PostgreSQL.
- Painel de administrador com acesso de backend para o e-mail do desenvolvedor e admins aprovados.
- Checkout Kiwify com confirmação por webhook assinado e confirmação adicional de venda pela API.

## Testes

```powershell
npm test
npm run lint
npx tsc --noEmit
npm run build
```

Os testes locais verificam o vetor HMAC oficial da Kiwify, alteração do corpo, deduplicação, parsing e critérios da venda paga. Para completar a verificação de ponta a ponta são necessários: migrations aplicadas no Supabase, credenciais Kiwify server-side, IDs reais de produto, e uma URL de produção para receber webhooks. A Kiwify não oferece sandbox; use o modo de teste apenas sabendo que eventos de teste não correspondem a vendas reais.

## Referências Kiwify

- [Receber e validar webhooks](https://docs.kiwify.com.br/api-reference/webhooks/receiving.md)
- [Eventos de assinatura](https://docs.kiwify.com.br/api-reference/webhooks/subscription-events.md)
- [OAuth](https://docs.kiwify.com.br/api-reference/auth/oauth.md)
- [Consultar venda](https://docs.kiwify.com.br/api-reference/sales/single.md)