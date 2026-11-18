# ADR 0009 — Organizações, contas vinculadas por organização e conexão Meta por organização

- **Status:** aceito (2026-11-17). A seção "Resultado da validação Meta Live" está **em branco**, aguardando o dono.
- **Contexto:** o dono quer monetizar várias páginas de nicho (por exemplo games e academia) nas quatro redes, num só painel. Em cada organização, o Instagram e a Página do Facebook já estão vinculados entre si na Meta; **não se sabe** se organizações diferentes ficam no mesmo Business Manager. O modelo da Fase 1 tinha `Brand` e `BrandMember`. Spec: [§4](../superpowers/specs/2026-11-17-organizacoes-e-cortador-design.md). Complementa a ADR [0005](0005-meta-system-user-unico-e-limite-fb.md), que previa um único System User: agora há um por Business Manager.
- **Decisão:**
  1. **`Brand` vira `Organization`** e `BrandMember` vira `OrganizationMember`, no código e na UI, enquanto a base é pequena. Cada organização tem nome, slug, fuso, idioma, tags do nicho, guia de voz, hashtags fixas, modelo de créditos, estilo de legenda, padrões de corte (`clipDefaults`), retenção e orçamento mensal de IA (`aiMonthlyBudgetUsd`, padrão US$ 50). Os papéis da Fase 1 passam a valer **por organização**.
  2. **Isolamento:** todas as telas e consultas são filtradas pela organização ativa e o acesso é verificado **no servidor**; uma organização não vê nada de outra.
  3. **`SocialAccount` por organização**, com unicidade (`platform`, `externalId`): uma conta externa só pode estar vinculada a **uma** organização. Credencial cifrada (AES-GCM); nunca devolvida pela API nem registrada em logs; cada mutação gera `AuditLog`. Cada conta tem `dailyLimit` opcional (nulo = sem limite próprio).
  4. **Meta (IG + FB): uma conexão por organização.** Padrão: token de **System User regular** do Business Manager que contém a Página e o IG daquela organização, **colado uma vez** no painel; o painel chama `/me/accounts` com `appsecret_proof` e guarda **só o token da Página, cifrado**, para as duas contas. Organizações em Business Managers diferentes usam System Users diferentes. **Plano B**, na mesma tela: Page token long-lived obtido pelo login de um administrador. Variáveis `META_APP_ID`, `META_APP_SECRET` e `META_GRAPH_VERSION` (sem padrão); sem elas, 503 "Integração não configurada".
  5. **YouTube:** OAuth web server por canal (`access_type=offline`, `prompt=consent`, PKCE S256), escopos `youtube.upload` e `youtube.readonly`, refresh token cifrado. Variáveis `GOOGLE_OAUTH_CLIENT_ID` e `GOOGLE_OAUTH_CLIENT_SECRET`. O guia oficial citado não descreve PKCE (❓ em [youtube.md](../07-integracoes/youtube.md) §3.5).
  6. **TikTok:** só o @ da conta, para o modo manual assistido (ADR [0004](0004-tiktok-manual-assistido.md)).
- **Alternativas:**
  - Manter `Brand` e criar `Organization` ao lado: dois nomes para o mesmo conceito.
  - Um único System User global (ADR 0005): não serve se as organizações estiverem em Business Managers diferentes.
  - Unified Login do Instagram, recomendada pela Meta para integrações novas ([instagram.md](../07-integracoes/instagram.md) §3.5): exigiria um segundo fluxo de token; fica como alternativa a reavaliar.
  - Facebook Login por usuário como padrão: fica preso à pessoa; entra só como plano B.
- **Consequências:**
  - O mesmo fluxo de conexão serve a um ou vários Business Managers.
  - O token do System User pode expirar (60 dias ou não expirante, ❓ em [instagram.md](../07-integracoes/instagram.md)); **a renovação automática não existe nesta fase**.
  - A cota do YouTube é por projeto do Google e fica **compartilhada** entre todas as organizações.
  - O risco nº 1 continua aberto (abaixo).

## Resultado da validação Meta Live

**Hipótese a testar pelo dono** (❓ em [facebook.md](../07-integracoes/facebook.md) §4 e [instagram.md](../07-integracoes/instagram.md) §4): o app Meta pode ir para **Live usando só Standard Access, sem App Review**, e um Reel publicado fica **público**. Procedimento no [runbook do app Meta](../runbooks/meta-app.md) §6.

| Campo | Valor |
|---|---|
| Data do teste | _a preencher pelo dono_ |
| O painel deixou o app ir para Live só com Standard Access? | _a preencher_ |
| O que o painel exigiu (App Review, Business Verification, outro) | _a preencher_ |
| O post de teste ficou público para quem não tem papel no app? | _a preencher_ |
| Decisão (automático ligado / manual assistido + App Review) | _a preencher_ |

Se o teste falhar, o IG e o FB caem para manual assistido (D2 em [21](../21-debitos-tecnicos.md)) e o pedido de App Review começa na hora ([spec §10](../superpowers/specs/2026-11-17-organizacoes-e-cortador-design.md)).
