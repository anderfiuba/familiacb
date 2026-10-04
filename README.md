# familiacb

Conversor familiar de **reais → pesos argentinos**:
Mercado Bitcoin (compra USDT) → rede **Polygon** → Bitso Argentina (vende USDT por ARS) → saque opcional para CBU/CVU/alias.

Stack: Next.js 15 (App Router) · Supabase (Auth + Postgres + RLS) · Tailwind · Vercel.

---

## Como funciona

```
Você envia R$ ──▶ [1] Compra USDT no MB ──▶ [2] Envio Polygon ──▶ [3] Chegada na Bitso ──▶ [4] Venda por ARS ──▶ Pesos na conta
```

A conversão é uma **máquina de estados** salva no banco (`operations`). A tela de progresso chama
`/api/operations/:id/advance` a cada 3 s, e cada chamada executa **no máximo um passo**, sob lock.

- **Retomada:** se a aba fechar, a conversão continua do mesmo ponto quando a pessoa abrir o site de novo.
- **Idempotência:** antes de cada ação na exchange o estado vira `*_submitting`. Se a resposta se perder, a recuperação procura a ordem ou o saque pelo identificador da operação (`externalId` no MB, `origin_id` na Bitso) em vez de repetir a ação.
- **Uma operação por vez:** só existe uma conversão ativa por usuário (índice único no banco).

## Segurança

| Camada | O que faz |
|---|---|
| Acesso | Só por convite do administrador. Cadastro público desligado. |
| Login | Senha de 12+ caracteres **e** autenticador TOTP obrigatório (AAL2) em todas as páginas e APIs. |
| Ações sensíveis | Código do autenticador **de novo**, sem reaproveitar código, para: salvar ou remover chaves, alterar o destino do USDT, converter, sacar, convidar e mudar limites. |
| Sessão | Cookies `HttpOnly` + `Secure` + `SameSite=Lax`. O JavaScript do navegador nunca vê tokens. Todo o auth roda no servidor. |
| Chaves das exchanges | Cifradas com **AES-256-GCM**, com AAD amarrando o dado ao usuário e à exchange. A chave mestra fica só no Vercel. As chaves nunca voltam ao navegador; a tela mostra só os últimos 4 caracteres. |
| Banco | RLS em todas as tabelas. Credenciais, auditoria, rate limit e anti-replay de códigos **não têm policy nenhuma**: só a service role, no servidor, acessa. |
| Valores | O servidor **recalcula a cotação**; o navegador nunca define valores. Os limites (R$ 5.000 por operação, R$ 15.000 por dia) são checados de forma atômica no Postgres. |
| CSRF / XSS | Checagem de `Origin` em toda escrita. CSP com nonce por requisição, `frame-ancestors 'none'`, HSTS, `nosniff`. |
| Abuso | Rate limit por IP e por e-mail no login, e por usuário em cada ação. Log de auditoria de tudo que é sensível. |
| Saque cripto | Só para o endereço que você cadastrou como **confiável no MB** e só a partir do **IP fixo** registrado no Saque Automatizado. |
| Venda na Bitso | `slippage_tolerance` de 2%: se o preço piorar mais que isso, a Bitso cancela a venda e o USDT fica guardado. |

---

## Instalação, passo a passo

### 1. Supabase

1. Crie um projeto em [supabase.com](https://supabase.com) (região São Paulo).
2. Abra **SQL Editor**, cole o conteúdo de `supabase/migrations/0001_init.sql` e rode.
3. Em **Authentication → Sign In / Providers → Email**, **desligue** "Allow new users to sign up". Convites continuam funcionando.
4. Em **Authentication → URL Configuration**:
   - Site URL: `https://familiacb.vercel.app`
   - Redirect URLs: `https://familiacb.vercel.app/**`
5. Em **Authentication → Emails → Templates**:
   - No template **Invite user**, troque o link por:
     `{{ .SiteURL }}/auth/confirmar?token_hash={{ .TokenHash }}&type=invite`
   - No template **Reset password**, troque o link por:
     `{{ .SiteURL }}/auth/confirmar?token_hash={{ .TokenHash }}&type=recovery`
6. Em **Authentication → Multi-Factor**, confirme que **TOTP** está habilitado.
7. **Torne-se administrador:**
   - Em **Authentication → Users → Invite user**, convide o seu próprio e-mail.
   - Depois rode no SQL Editor:
     ```sql
     update public.profiles set role = 'admin'
      where id = (select id from auth.users where email = 'SEU@EMAIL');
     ```
   - A partir daí, convide a família pela tela **Família** do site.

### 2. Proxy de IP fixo (Oracle Cloud Always Free)

O Mercado Bitcoin só aceita saque cripto pela API a partir de um IP cadastrado. O Vercel não tem IP fixo, então as chamadas privadas ao MB saem por um proxy seu.

1. Crie uma conta em [cloud.oracle.com](https://cloud.oracle.com) e uma instância **Always Free** com Ubuntu 22.04 ou 24.04.
2. Em **Networking → Reserved Public IPs**, reserve um IP e associe à VM, para que o IP não mude.
3. Copie `infra/oracle-proxy/install.sh` para a VM e rode `sudo bash install.sh`.
4. Na **Security List** da VCN, libere **TCP 8443** de entrada.
5. Guarde as duas linhas que o script imprime (`MB_EGRESS_PROXY_URL` e `MB_EGRESS_PROXY_CA`).

O proxy só aceita conexões para `api.mercadobitcoin.net:443`, exige senha, usa TLS com certificado fixado no app e **não consegue ler** o tráfego, que continua cifrado de ponta a ponta até o MB.

### 3. Mercado Bitcoin (cada usuário)

1. Ative a autenticação em dois fatores na conta.
2. Crie uma chave de API com permissão de **negociação** e **saque**. Anote o **Client ID** e o **Client Secret**.
3. Em **Saque Automatizado**:
   - Cadastre o **IP fixo** da VM.
   - Cadastre como endereço confiável o **endereço USDT (Polygon) da Bitso**.

### 4. Bitso (cada usuário)

1. Crie uma chave de API com **ver saldo**, **negociar** e **sacar**.
2. Copie o endereço de depósito de **USDT na rede Polygon**. O app tenta ler esse endereço automaticamente pela API; se não conseguir, cole manualmente em Configurações.

### 5. Vercel

1. Suba esta pasta para um repositório no GitHub e importe no Vercel. Use Node.js 22, o padrão atual do Vercel.
2. Em **Settings → Environment Variables (Production)**, cadastre as variáveis de `.env.example`:

   | Variável | De onde vem |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Project Settings → API |
   | `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API. **Nunca** com prefixo `NEXT_PUBLIC_`. |
   | `CREDENTIALS_ENCRYPTION_KEY` | Gere com `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` e guarde uma cópia offline. |
   | `APP_URL` | `https://familiacb.vercel.app` |
   | `MB_EGRESS_PROXY_URL` / `MB_EGRESS_PROXY_CA` | Saída do script do passo 2. |

3. Faça o deploy.

### 6. Primeiro uso

1. Entre com o convite, crie a senha e configure o autenticador.
2. Em **Configurações**:
   - Salve as duas chaves. Cada uma é testada na exchange antes de ser salva.
   - Confira o destino do USDT. O app avisa se ele **não** está na lista de confiáveis do MB.
   - Opcional: salve as contas bancárias argentinas.
3. Faça **uma conversão de teste de R$ 50** e um **saque pequeno** antes de valores maiores.

---

## Pontos a validar no primeiro teste

A documentação pública não detalha estes três pontos. O código já trata cada um com a opção mais segura, mas confirme com um valor pequeno:

1. **Travel Rule no MB.** O saque envia `INTERNATIONAL_TRANSFER`, país `AR`, VASP `"Bitso"` e finalidade `67995` ("Minha conta no exterior"). Se o MB recusar o nome do VASP, ajuste `counterparty_vasp` em `lib/server/exchanges/mercadobitcoin.ts`. A operação fica parada em "Envio para a Bitso" e dá para **retomar** sem perder nada.
2. **Saque de ARS na Bitso.** O app consulta os métodos de saque habilitados na sua conta (`/withdrawal_methods/ars`) e escolhe o campo certo (CBU, CVU ou alias). Se a Bitso recusar alias pela API, use o CBU ou o CVU.
3. **Endereço Polygon automático.** Se `funding_destination` não responder, informe o endereço manualmente em Configurações.

## Desenvolvimento local

```bash
cp .env.example .env.local   # preencha
npm install
npm run dev                  # http://localhost:3000
npm test                     # testes do motor de cotação
npm run typecheck
```

## Estrutura

```
app/
  api/            rotas do servidor (auth, cotação, operações, saques, admin)
  app/            telas logadas: conversor, progresso, histórico, configurações, família
  entrar, verificar, definir-senha, auth/confirmar
components/       interface (conversor, trajeto/progresso, saque, configurações)
lib/
  quote.ts        motor de cotação puro (com testes)
  steps.ts        etapas e progresso mostrados ao usuário
  server/         guardas de segurança, cifragem, clientes MB/Bitso, máquina de estados
supabase/migrations/0001_init.sql
infra/oracle-proxy/install.sh
```
