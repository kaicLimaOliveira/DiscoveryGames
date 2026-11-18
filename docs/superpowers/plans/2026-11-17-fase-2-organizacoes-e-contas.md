# Fase 2 — Organizações e Contas Vinculadas: plano de implementação

> **Para agentes:** SUB-SKILL OBRIGATÓRIA: use superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans para executar este plano tarefa a tarefa. Os passos usam checkbox (`- [ ]`).

**Objetivo:** permitir criar e gerenciar várias organizações no painel, cada uma com configurações próprias e com suas contas de Instagram, Página do Facebook, canal do YouTube e @ do TikTok vinculadas.

**Arquitetura:** o conceito `Brand` da Fase 1 passa a se chamar `Organization`. A renomeação é feita com SQL que preserva os dados. Ganham novos campos de configuração e uma tabela `SocialAccount` por organização, com credencial cifrada (AES-GCM da Fase 1). Os clientes HTTP da Meta (Graph) e do Google (OAuth + canais) ficam em `@central/platforms`, com `fetch` injetável para testes sem rede. As regras de negócio ficam em `@central/core`. As rotas Nuxt ficam sob `/api/orgs/[orgId]/…`, com a autorização sempre no servidor pela organização do caminho.

**Stack:** a da Fase 1, sem dependências novas de runtime: pnpm 10, TypeScript ~6.0.3, Prisma 7.10.1, Nuxt 4 + nuxt-auth-utils, zod 4, Vitest 5, Testcontainers e Playwright.

**Spec:** [docs/superpowers/specs/2026-11-17-organizacoes-e-cortador-design.md](../specs/2026-11-17-organizacoes-e-cortador-design.md), §4, §6, §7 e §9. Esta fase cobre a parte de **organizações e contas**. O cortador e a publicação vêm nas Fases 3 a 5.

## Restrições globais

**Herdadas da Fase 1:**
- Não inventar endpoints, permissões nem funcionalidades. Todo endpoint externo usado aqui está citado em `docs/07-integracoes/` com a fonte. O que lá estiver marcado ❓ não vira premissa de código.
- Autorização sempre no servidor, nunca só na UI.
- Credenciais **nunca** saem pela API nem aparecem em logs.
- Toda mutação relevante gera `AuditLog`.

**Novas desta fase:**
- **Unicidade da conta externa:** uma conta externa (`platform` + `externalId`) só pode estar vinculada a **uma** organização (spec §4).
- **Escopo por organização:** todas as telas e consultas são filtradas pela organização ativa. Uma organização não vê nada da outra (spec §2 e §11).
- **Meta:**
  - uma conexão Meta por organização;
  - o padrão é o token de **System User** do Business Manager, e o plano B, aceito na mesma tela, é o Page token long-lived de um admin;
  - os dois casos funcionam com Business Manager único ou com vários (spec §4).
- **YouTube:** OAuth web server com `access_type=offline` e refresh token cifrado. Escopos `https://www.googleapis.com/auth/youtube.upload` e `https://www.googleapis.com/auth/youtube.readonly` (docs/07 youtube.md §escopos).
- **TikTok:** só o @ da conta (modo manual assistido, ADR 0004).
- **Limite diário de publicações:** configurável por conta vinculada (`dailyLimit`, nulo = sem limite próprio). O uso desse limite vem na Fase 5 (spec §5.5).
- **Valores padrão da organização (spec §5.3, §5.4.1, §3):**
  - orçamento de IA US$ 50 por mês;
  - cortes: alvo de 5 a 10 por fonte, duração de 30 a 90 s;
  - retenção: original 30 dias após o último corte publicado, 14 dias sem corte aceito, cortes renderizados 90 dias.
- **Integrações opcionais por configuração:** sem `META_APP_ID`/`META_APP_SECRET`/`META_GRAPH_VERSION`, ou sem `GOOGLE_OAUTH_CLIENT_ID`/`GOOGLE_OAUTH_CLIENT_SECRET`, a integração correspondente responde **503 "Integração não configurada"** e o resto do painel funciona. `META_GRAPH_VERSION` **não tem valor padrão**: o dono confirma a versão vigente no painel da Meta.
- **Idioma:** textos da UI e mensagens de erro em pt-BR.

## Pontos de atenção na revisão

Estas entradas não são cobertas pelos testes de nenhuma tarefa por si só. Cada linha tem o seu teste na tarefa dona.

1. **Acesso cruzado entre organizações.** Um membro da organização A chamando `/api/orgs/<B>/…` recebe 403. Um `accountId` da organização B pedido pelo caminho da organização A recebe **404**, nunca a conta de B. Testes nas Tasks 3 e 4.
2. **Mesma conta externa em duas organizações.** A segunda vinculação recebe **409** "Esta conta já está vinculada a outra organização." e nada muda. Inclui Meta, YouTube e TikTok. O @ do TikTok é comparado sem `@` e em minúsculas. Testes nas Tasks 4, 5 e 6.
3. **Token Meta inválido ou expirado, ou Página sem Instagram vinculado.** Recebe **422** com mensagem clara e nada é gravado. Página sem IG pode ser vinculada só como Facebook, se o usuário confirmar. Testes na Task 5.
4. **Callback OAuth do Google problemático:** `state` inexistente, expirado, já usado ou de outro usuário, `error=access_denied`, ou resposta sem `refresh_token`. Em todos os casos o callback é recusado, nada é gravado e o usuário volta para a tela de contas com o motivo. Testes na Task 6.
5. **Credenciais nunca vazam.** `GET` de contas nunca devolve a credencial. Logs com `accessToken`, `refresh_token`, `Authorization` ou `access_token` em qualquer caixa ficam redigidos. Testes nas Tasks 2 e 4.

---

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `packages/db/prisma/schema.prisma` | Renomeia `Brand*`, adiciona campos de organização e cria `SocialAccount` e `OAuthState` |
| `packages/db/prisma/migrations/<ts>_organizations/migration.sql` | Renomeações com preservação de dados, mais os campos novos |
| `packages/db/prisma/migrations/<ts>_social_accounts/` e `<ts>_oauth_state/` | Tabelas `SocialAccount` (Task 4) e `OAuthState` (Task 6) |
| `packages/shared/src/logger.ts` | Redação sem distinção de caixa, cobrindo nomes de token |
| `packages/core/src/organizations/organization-service.ts` | CRUD e configurações de organização, listagem por ator |
| `packages/core/src/accounts/account-service.ts` | Vincular e desvincular contas, unicidade, credencial cifrada, auditoria |
| `packages/core/src/accounts/oauth-state.ts` | Criar e consumir `state` OAuth de uso único |
| `packages/platforms/src/meta/graph-client.ts` | `discoverPages(token)` com `appsecret_proof` |
| `packages/platforms/src/youtube/google-oauth.ts` | URL de autorização com PKCE, troca de código, canal do usuário, revogação |
| `apps/web/server/api/orgs/**` | Rotas de organização, membros e contas |
| `apps/web/server/api/oauth/youtube/callback.get.ts` | Callback OAuth do Google |
| `apps/web/app/pages/orgs/**`, `apps/web/app/components/OrgSwitcher.vue` | Telas e seletor de organização |
| `docs/runbooks/meta-app.md` | Passo a passo do dono para validar o app Meta Live (risco nº 1) |

---

### Task 1: Renomear Brand → Organization e adicionar os campos da organização

**Arquivos:**
- Modificar: `packages/db/prisma/schema.prisma`
- Criar: `packages/db/prisma/migrations/<timestamp>_organizations/migration.sql`
- Modificar: todo uso de `brand`, `Brand`, `brandId`, `BrandRole` e `BrandMember`:
  - `packages/core/src/**` (`authz/roles.ts`, `authz/actor.ts`, `audit.ts`, `auth/identity-service.ts`);
  - `apps/web/server/**`, `apps/web/app/**`;
  - os testes de `packages/*/test`, `apps/web/test` e `apps/web/e2e`.
- Remover: `apps/web/server/api/admin/brands.get.ts` e `apps/web/server/api/admin/brands/**`. Esses arquivos são substituídos na Task 3.
- Testes: `packages/db/test/schema.test.ts` (campos novos) e `packages/db/test/migration-rename.test.ts`.

**Interfaces:**
- Produz:
  - modelos Prisma `Organization` e `OrganizationMember`, e o enum `OrganizationRole` (`viewer | editor | approver | admin`);
  - nas tabelas `Setting` e `AuditLog`, a coluna passa a ser `organizationId`;
  - o tipo `Actor.memberships: Array<{ organizationId: string; role: OrganizationRole }>`;
  - `can(actor, organizationId: string | null, action)`;
  - `writeAudit(db, { …, organizationId? })`.
- Campos novos de `Organization` (spec §4 e §7):
  - `tags String[] @default([])`;
  - `voiceGuide String @default("")`, que substitui o `Json` atual;
  - `fixedHashtags String[] @default([])`;
  - `creditTemplate String @default("Créditos: {creator}")`;
  - `captionStyle Json @default("{}")`;
  - `clipDefaults Json @default("{\"targetMin\":5,\"targetMax\":10,\"minSec\":30,\"maxSec\":90}")`;
  - `retention Json @default("{\"sourceDays\":30,\"unusedSourceDays\":14,\"clipDays\":90}")`;
  - `aiMonthlyBudgetUsd Decimal @default(50) @db.Decimal(10,2)`, que deixa de ser opcional.

- [ ] **Step 1: Escrever o teste que falha, `migration-rename.test.ts`.**
  - Aplicar a migração `identity` sozinha.
  - Inserir uma `Brand`, um `BrandMember`, um `Setting` com `brandId` e um `AuditLog` com `brandId`.
  - Aplicar a migração nova.
  - Asserções:
    - a linha está em `Organization` com o mesmo `id`, `name` e `slug`;
    - `OrganizationMember` mantém `role`;
    - `Setting.organizationId` e `AuditLog.organizationId` apontam para o mesmo id;
    - `aiMonthlyBudgetUsd = 50`;
    - `clipDefaults` e `retention` têm os valores padrão acima.

  Use o helper `startTestDatabase` de `@central/db/testing`. Se ele não aceitar aplicar migrações parciais, adicione nele a opção `{ upTo?: string }`.
- [ ] **Step 2: Rodar o teste e ver falhar.** Comando: `pnpm --filter @central/db test -- migration-rename`. Esperado: FALHA (a migração não existe).
- [ ] **Step 3: Escrever o schema e a migração.**
  - A migração é escrita **à mão** com `ALTER TABLE … RENAME TO`, `ALTER TABLE … RENAME COLUMN`, `ALTER TYPE "BrandRole" RENAME TO "OrganizationRole"` e a renomeação de constraints e índices. Assim os dados ficam preservados.
  - O índice único `(organizationId, key) NULLS NOT DISTINCT` de `Setting` é recriado com o nome novo.
  - Gere com `prisma migrate dev --create-only` e substitua o corpo pelos `RENAME`.
  - Confira com `prisma migrate diff`: o schema final não pode ter diferença.
- [ ] **Step 4: Rodar o teste e ver passar.** Mesmo comando. Esperado: PASSA.
- [ ] **Step 5: Renomear os usos no código.** Isso cobre core, web e testes. A UI passa a dizer "Organização" em vez de "Marca". Comandos: `pnpm typecheck`, `pnpm lint`, `pnpm test` e `pnpm test:web`. Esperado: tudo verde, já que só o nome mudou (e as rotas de brands foram removidas junto com os seus testes, que voltam na Task 3).
- [ ] **Step 6: Commit.** Mensagem: `refactor: renomear Brand para Organization e adicionar configurações da organização`.

### Task 2: Redação de tokens nos logs, sem distinção de caixa

Esta tarefa fecha o débito da revisão final da Fase 1: "antes do OAuth, tornar a redação insensível a caixa e cobrir camelCase".

**Arquivos:**
- Modificar: `packages/shared/src/logger.ts`
- Teste: `packages/shared/test/logger.test.ts`

**Interfaces:**
- Produz: o mesmo `createLogger`. O que muda é o comportamento: a comparação das chaves sensíveis passa a ignorar a caixa e a remover `_` e `-`.
- A lista de chaves sensíveis passa a cobrir:
  - `password`, `token`, `accessToken`, `refreshToken`, `idToken`;
  - `secret`, `clientSecret`, `appSecret`;
  - `authorization`, `cookie`, `setCookie`;
  - `apiKey`, `codeVerifier`, `credential` e `credentialEnc`.
- `code` continua redigido só sob `query`, `body` e `params`, como já é hoje.

- [ ] **Step 1: Escrever o teste que falha.** Nome do teste: `'redige chaves sensíveis em qualquer caixa e formato'`. Logar o objeto:

  ```ts
  { accessToken: 'a', refresh_token: 'b', Authorization: 'Bearer c', 'set-cookie': 'd', nested: { ACCESS_TOKEN: 'e', credentialEnc: 'f' }, err: { code: 'ECONNREFUSED' } }
  ```

  Asserções:
  - `a` a `f` não aparecem na saída;
  - cada um desses valores vira `"[REDACTED]"`;
  - `err.code` continua `"ECONNREFUSED"`.
- [ ] **Step 2: Rodar o teste e ver falhar.** Comando: `pnpm --filter @central/shared test -- logger`. Esperado: FALHA nos valores `a`, `b`, `c`, `d` e `e`.
- [ ] **Step 3: Implementar.** A normalização é `key.toLowerCase().replace(/[-_]/g, '')`, comparada contra um `Set` normalizado. Ela é aplicada no scrub recursivo que já existe, porque os `REDACT_PATHS` do pino não aceitam padrões sem distinção de caixa.
- [ ] **Step 4: Rodar o teste e ver passar.** Mesmo comando, mais a suíte inteira do pacote. Esperado: PASSA.
- [ ] **Step 5: Commit.** Mensagem: `fix(shared): redigir tokens em qualquer caixa nos logs`.

### Task 3: Serviço de organizações e rotas de organização e membros

**Arquivos:**
- Criar:
  - `packages/core/src/organizations/organization-service.ts`;
  - `apps/web/server/api/orgs/index.get.ts` e `index.post.ts`;
  - `apps/web/server/api/orgs/[orgId]/index.get.ts` e `index.patch.ts`;
  - `apps/web/server/api/orgs/[orgId]/members/[userId].put.ts` e `.delete.ts`.
- Modificar:
  - `packages/core/src/authz/roles.ts` (nova ação);
  - `packages/core/src/index.ts`;
  - `apps/web/server/utils/services.ts`.
- Testes:
  - `packages/core/test/organizations/organization-service.test.ts`;
  - `apps/web/test/orgs.test.ts`.

**Interfaces:**
- Consome: `can`, `writeAudit` e `Actor` (Task 1); `identity.setMembership(actor, organizationId, userId, role)`, já existente e renomeado na Task 1.
- Produz:
  - Nova `Action` `'organizations.create'`, com papel mínimo `admin`, sempre verificada com `organizationId = null`. Na prática só o admin global cria organizações.
  - `createOrganizationService({ db, now? })`, que devolve:
    - `list(actor): Promise<OrganizationSummary[]>`. O admin global vê todas e os demais só as suas, ordenadas por nome.
    - `get(actor, id): Promise<OrganizationDetail>`. Exige `library.read`. Organização inexistente ou de outra pessoa lança `NotFoundError`, para não revelar a existência.
    - `create(actor, input: { name: string; slug?: string; timezone?: string; locale?: string }): Promise<OrganizationDetail>`. O `slug` é derivado do nome (minúsculas, sem acento, hífens) quando não é informado. Slug repetido lança `ConflictError('Já existe uma organização com este identificador.')`.
    - `update(actor, id, patch: OrganizationSettingsPatch): Promise<OrganizationDetail>`. Exige `settings.manage`.
  - `OrganizationSettingsPatch` é um subconjunto opcional de `name`, `timezone`, `locale`, `tags`, `voiceGuide`, `fixedHashtags`, `creditTemplate`, `captionStyle`, `clipDefaults` e `aiMonthlyBudgetUsd`, com as regras:
    - `tags` e `fixedHashtags`: máximo de 30 itens com até 50 caracteres cada, normalizados (sem `#`, minúsculas, sem duplicatas);
    - `clipDefaults`: `1 ≤ targetMin ≤ targetMax ≤ 20` e `15 ≤ minSec < maxSec ≤ 180`;
    - `aiMonthlyBudgetUsd`: de 0 a 10.000;
    - `timezone`: deve ser um fuso IANA válido (`Intl.supportedValuesOf('timeZone')`).
  - Toda criação e toda alteração gera `writeAudit` com `entityType: 'organization'` e o diff dos campos alterados.
  - O `NotFoundError` é criado em `packages/core/src/errors.ts` se ainda não existir, e o `toHttpError` passa a mapeá-lo para **404**. Isso também fecha o débito "não encontrado vira 422" da revisão final.
  - Rotas:

    | Rota | Ação |
    |---|---|
    | `GET /api/orgs` | `list` |
    | `POST /api/orgs` | `create` (201) |
    | `GET /api/orgs/[orgId]` | `get` |
    | `PATCH /api/orgs/[orgId]` | `update` |
    | `PUT/DELETE /api/orgs/[orgId]/members/[userId]` | o mesmo comportamento das antigas rotas de brands, ainda exigindo `users.manage` com `null` (só admin global) |

- [ ] **Step 1: Escrever os testes do serviço que falham.**
  - `'admin global cria organização com slug derivado'`: o nome `'Academia Força Total'` gera o slug `'academia-forca-total'`, e `aiMonthlyBudgetUsd` vale `50`.
  - `'slug repetido gera ConflictError'`.
  - `'membro só lista as próprias organizações'`.
  - `'get de organização alheia lança NotFoundError'`.
  - `'update exige settings.manage'`: o editor recebe `ForbiddenError` e o admin da organização consegue.
  - `'update normaliza tags'`: `['#Games', 'games', 'PS5']` vira `['games', 'ps5']`.
  - `'update rejeita clipDefaults inválido'`: `minSec: 100` com `maxSec: 90` lança `ValidationError`.
  - `'update grava auditoria com diff'`.
- [ ] **Step 2: Rodar e ver falhar.** Comando: `pnpm --filter @central/core test -- organization-service`. Esperado: FALHA (o módulo não existe).
- [ ] **Step 3: Implementar o serviço** e registrá-lo em `useServices()` como `organizations`.
- [ ] **Step 4: Rodar e ver passar.** Mesmo comando. Esperado: PASSA.
- [ ] **Step 5: Escrever os testes de rota que falham em `apps/web/test/orgs.test.ts`.** Use os helpers existentes (`createUser`, login com TOTP), renomeando `createBrand` para `createOrganization`.
  - Matriz 401/403:
    - sem sessão: 401;
    - um membro com `viewer` dá `PATCH` na própria organização: 403;
    - um membro da organização A dá `GET` ou `PATCH` em `/api/orgs/<B>`: **404**;
    - um não admin dá `POST /api/orgs`: 403.
  - `POST /api/orgs` com `{ name: 'GamerDoido' }` devolve 201, com `slug: 'gamerdoido'`.
  - `PATCH` com `tags` devolve as tags normalizadas.
  - `PUT /api/orgs/[orgId]/members/[userId]` com `{ role: 'editor' }` devolve 204 e invalida a sessão do usuário alvo (`sessionVersion`), como na Fase 1.
- [ ] **Step 6: Rodar e ver falhar.** Comando: `pnpm test:web -- orgs`. Esperado: FALHA (as rotas não existem).
- [ ] **Step 7: Implementar as rotas** com `defineApiHandler`, `paramsValidated` e `readValidated`, que já existem.
- [ ] **Step 8: Rodar e ver passar.** Comando: `pnpm test:web`. Esperado: PASSA.
- [ ] **Step 9: Commit.** Mensagem: `feat: serviço e API de organizações`.

### Task 4: `SocialAccount`, serviço de contas, TikTok e rotas de contas

**Arquivos:**
- Modificar: `packages/db/prisma/schema.prisma`
- Criar:
  - `packages/db/prisma/migrations/<timestamp>_social_accounts/migration.sql`;
  - `packages/core/src/accounts/account-service.ts`;
  - `apps/web/server/api/orgs/[orgId]/accounts/index.get.ts`;
  - `apps/web/server/api/orgs/[orgId]/accounts/tiktok.post.ts`;
  - `apps/web/server/api/orgs/[orgId]/accounts/[accountId].patch.ts` e `.delete.ts`.
- Testes:
  - `packages/core/test/accounts/account-service.test.ts`;
  - `apps/web/test/accounts.test.ts`.

**Interfaces:**
- Produz o modelo Prisma:

  ```prisma
  enum SocialPlatform { instagram facebook youtube tiktok }
  enum AccountStatus  { active needs_reauth }
  model SocialAccount {
    id             String         @id @default(uuid(7)) @db.Uuid
    organizationId String         @db.Uuid
    platform       SocialPlatform
    externalId     String
    displayName    String
    status         AccountStatus  @default(active)
    credentialEnc  String?
    scopes         String[]       @default([])
    dailyLimit     Int?
    connectedById  String?        @db.Uuid
    createdAt      DateTime       @default(now()) @db.Timestamptz(3)
    updatedAt      DateTime       @updatedAt @db.Timestamptz(3)
    organization   Organization   @relation(fields: [organizationId], references: [id], onDelete: Cascade)
    @@unique([platform, externalId])
    @@index([organizationId])
  }
  ```

- Produz `createAccountService({ db, cipher, now? })`, que devolve:
  - `list(actor, orgId): Promise<AccountView[]>`. Exige `library.read`. O `AccountView` tem `{ id, platform, externalId, displayName, status, scopes, dailyLimit, createdAt }` e **nunca** inclui `credentialEnc`.
  - `linkTiktok(actor, orgId, handle: string): Promise<AccountView>`. Exige `accounts.manage`. O handle é normalizado (remove `@` e espaços, minúsculas) e validado com `/^[a-z0-9._]{2,24}$/`, vira o `externalId`, e o `displayName` fica `@handle`.
  - `upsertLinked(actor, orgId, input: LinkedAccountInput): Promise<AccountView>`. Uso interno, consumido pelas Tasks 5 e 6. Recebe `LinkedAccountInput = { platform; externalId; displayName; credential: unknown; scopes: string[] }`.
    - Se a conta já pertence a **outra** organização, lança `ConflictError('Esta conta já está vinculada a outra organização.')`.
    - Se pertence à **mesma** organização, atualiza a credencial e os escopos e volta o `status` para `active` (é uma reconexão).
    - A credencial é cifrada com `cipher.encrypt(JSON.stringify(credential), aad)`, com `aad = \`social_account:${platform}:${externalId}\``. A AAD usa a chave natural porque o `id` ainda não existe no momento do insert.
  - `readCredential(orgId, accountId): Promise<unknown>`. Uso interno, a ser usado pela Fase 5. Lança `NotFoundError` se a conta não for daquela organização.
  - `setDailyLimit(actor, orgId, accountId, limit: number | null)`. Exige `accounts.manage`, com limite entre 1 e 1000 ou `null`.
  - `disconnect(actor, orgId, accountId, revoke?: (credential: unknown) => Promise<void>)`. Exige `accounts.manage`.
    - Chama `revoke` como melhor esforço: uma falha é registrada em log e não impede a remoção.
    - Depois **apaga** a linha. **[call]:** com a remoção física, reconectar a conta em outra organização fica possível. A auditoria guarda o registro.
  - Toda mutação gera `writeAudit` com `entityType: 'social_account'`. O diff **nunca** inclui a credencial.
  - Um `accountId` de outra organização lança `NotFoundError` (404).
- Rotas:

  | Rota | Ação | Resposta |
  |---|---|---|
  | `GET /api/orgs/[orgId]/accounts` | `list` | `{ accounts }` |
  | `POST /api/orgs/[orgId]/accounts/tiktok` | `linkTiktok`, corpo `{ handle }` | 201 |
  | `PATCH /api/orgs/[orgId]/accounts/[accountId]` | `setDailyLimit`, corpo `{ dailyLimit: number \| null }` | — |
  | `DELETE /api/orgs/[orgId]/accounts/[accountId]` | `disconnect`, com o `revoke` adequado à plataforma (o do Google vem na Task 6; Meta e TikTok não revogam) | 204 |

- [ ] **Step 1: Escrever os testes do serviço que falham.**
  - `'linkTiktok normaliza @ e caixa'`: `' @GamerDoido '` vira `externalId 'gamerdoido'` e `displayName '@gamerdoido'`.
  - `'linkTiktok rejeita handle inválido'`: `'a'` e `'nome com espaço'` lançam `ValidationError`.
  - `'mesma conta em outra organização gera ConflictError e não altera nada'`.
  - `'upsertLinked na mesma organização reconecta e reativa'`: com `status: needs_reauth`, a reconexão volta para `active` e troca a credencial.
  - `'credencial é cifrada e list nunca a expõe'`:
    - `credentialEnc` não contém o texto puro do token;
    - as chaves de `list()` são exatamente as do `AccountView`;
    - `readCredential` devolve o objeto original.
  - `'conta de outra organização gera NotFoundError em setDailyLimit, disconnect e readCredential'`.
  - `'disconnect remove mesmo se revoke falhar e audita sem credencial'`.
  - `'setDailyLimit valida faixa'`: `0` e `1001` lançam `ValidationError`; `null` passa.
- [ ] **Step 2: Rodar e ver falhar.** Comando: `pnpm --filter @central/core test -- account-service`. Esperado: FALHA.
- [ ] **Step 3: Implementar o schema, a migração e o serviço.** Registre o serviço em `useServices()` como `accounts`.
- [ ] **Step 4: Rodar e ver passar.** Esperado: PASSA.
- [ ] **Step 5: Escrever os testes de rota que falham em `accounts.test.ts`.**
  - O `GET` não contém `credentialEnc` em nenhum item: assertar com `JSON.stringify(body)` sem o texto `credential`.
  - Um membro com `viewer` lista as contas, mas `POST tiktok` dá 403.
  - Um admin da organização A dá `DELETE` numa conta da organização B pelo caminho de A: 404.
  - TikTok duplicado entre organizações: 409 com a mensagem acima.
  - `PATCH dailyLimit` com `5` responde 200 e `dailyLimit: 5`.
- [ ] **Step 6: Rodar, implementar as rotas e rodar de novo.** Comando: `pnpm test:web -- accounts`. Esperado: primeiro FALHA, depois PASSA.
- [ ] **Step 7: Commit.** Mensagem: `feat: contas vinculadas por organização e vínculo do TikTok`.

### Task 5: Conexão Meta (Instagram + Página do Facebook)

**Arquivos:**
- Criar:
  - `packages/platforms/src/meta/graph-client.ts`;
  - `apps/web/server/api/orgs/[orgId]/accounts/meta/discover.post.ts`;
  - `apps/web/server/api/orgs/[orgId]/accounts/meta/connect.post.ts`.
- Modificar:
  - `packages/platforms/src/index.ts`;
  - `apps/web/server/utils/config.ts` (variáveis opcionais `META_APP_ID`, `META_APP_SECRET` e `META_GRAPH_VERSION`, esta no formato `/^v\d+\.\d+$/`);
  - `apps/web/server/utils/services.ts`.
- Testes:
  - `packages/platforms/test/meta/graph-client.test.ts`;
  - `apps/web/test/accounts-meta.test.ts`.

**Interfaces:**
- Produz `createMetaGraphClient({ appSecret, graphVersion, fetchFn = fetch })` com o método `discoverPages(token): Promise<MetaPage[]>`.
  - `MetaPage = { pageId; pageName; pageAccessToken; instagram: { id; username } | null }`.
  - A chamada é `GET https://graph.facebook.com/{graphVersion}/me/accounts?fields=id,name,access_token,instagram_business_account{id,username}&access_token=…&appsecret_proof=…`, fonte docs/07 facebook.md [F11] e instagram.md.
  - O `appsecret_proof` é o HMAC-SHA256 hex do token com o `appSecret`.
  - O método segue a paginação `paging.next` até o fim, com no máximo 10 páginas.
- Mapeamento de erros. O pacote `platforms` não importa `core`, então o cliente lança erros de `@central/shared`, e as rotas convertem `PermanentError` em `ValidationError` (422) com a mesma mensagem:
  - HTTP 400 ou 401 com `error.code` 190 (token inválido ou expirado), ou `error.type` `OAuthException`, viram `PermanentError('Token da Meta inválido ou expirado.')`;
  - lista vazia vira `PermanentError('Nenhuma Página encontrada para este token. Confira se a Página foi atribuída ao System User.')`;
  - 5xx e falhas de rede viram `TransientError`, que a rota devolve como 502 `'A Meta não respondeu. Tente de novo.'`.
- Rotas:
  - **`POST …/accounts/meta/discover`**, corpo `{ token }`, exige `accounts.manage`. Devolve `{ pages: Array<{ pageId, pageName, instagram }> }`, **sem** os Page tokens.
  - **`POST …/accounts/meta/connect`**, corpo `{ token, pageId, includeFacebookWithoutInstagram?: boolean }`.
    - Chama `discoverPages` de novo, porque o token não é guardado entre as duas chamadas, e localiza a `pageId`.
    - Chama `upsertLinked` para `facebook` (`externalId = pageId`) e, se a Página tiver IG, para `instagram` (`externalId = instagram.id`, `displayName = '@' + username`).
    - A credencial das duas é `{ kind: 'meta_page', pageAccessToken }`.
    - Página sem IG e sem `includeFacebookWithoutInstagram` gera 422 `'Esta Página não tem Instagram vinculado. Confirme para vincular só o Facebook.'`.
    - As duas gravações acontecem na **mesma transação**. Um conflito em qualquer uma delas desfaz as duas.
  - Sem a configuração da Meta, as duas rotas respondem 503 `'Integração com a Meta não configurada.'`.

- [ ] **Step 1: Escrever os testes do cliente que falham**, com um `fetchFn` falso que registra a URL.
  - `'envia appsecret_proof correto'`: compara com `createHmac('sha256', secret).update(token).digest('hex')`.
  - `'mapeia páginas com e sem instagram'`.
  - `'segue paginação'`.
  - `'erro 190 vira PermanentError com mensagem de token'`.
  - `'lista vazia vira PermanentError com dica do System User'`.
  - `'500 vira TransientError'`.
- [ ] **Step 2: Rodar e ver falhar.** Comando: `pnpm --filter @central/platforms test -- graph-client`. Esperado: FALHA.
- [ ] **Step 3: Implementar o cliente** com os erros de `@central/shared` descritos nas Interfaces.
- [ ] **Step 4: Rodar e ver passar.** Esperado: PASSA.
- [ ] **Step 5: Escrever os testes de rota que falham.** O servidor de teste injeta o cliente falso via `useServices().metaGraph`, substituível por um mock de rede: o servidor Nitro de teste aponta `META_GRAPH_BASE_URL` (variável **só de teste**, ignorada em produção quando `NODE_ENV=production`) para um servidor HTTP local do próprio teste.
  - `discover` não devolve `access_token` no corpo.
  - `connect` cria 2 contas (FB + IG) com `credentialEnc` preenchido.
  - Uma Página sem IG e sem a confirmação dá 422; com a confirmação, cria 1 conta.
  - Um IG já vinculado em outra organização dá 409 e nenhuma conta é criada, nem a do FB.
  - Um token inválido dá 422.
  - Sem `META_*`: 503.
- [ ] **Step 6: Rodar, implementar as rotas e rodar de novo.** Comando: `pnpm test:web -- accounts-meta`. Esperado: primeiro FALHA, depois PASSA.
- [ ] **Step 7: Commit.** Mensagem: `feat: conexão Meta (Instagram e Página do Facebook) por organização`.

### Task 6: Conexão YouTube (OAuth do Google)

**Arquivos:**
- Modificar: `packages/db/prisma/schema.prisma` (modelo `OAuthState`).
- Criar: `packages/db/prisma/migrations/<timestamp>_oauth_state/migration.sql`.
- Criar:
  - `packages/core/src/accounts/oauth-state.ts`;
  - `packages/platforms/src/youtube/google-oauth.ts`;
  - `apps/web/server/api/orgs/[orgId]/accounts/youtube/start.get.ts`;
  - `apps/web/server/api/oauth/youtube/callback.get.ts`.
- Modificar: `apps/web/server/utils/config.ts` (variáveis opcionais `GOOGLE_OAUTH_CLIENT_ID` e `GOOGLE_OAUTH_CLIENT_SECRET`).
- Testes:
  - `packages/platforms/test/youtube/google-oauth.test.ts`;
  - `packages/core/test/accounts/oauth-state.test.ts`;
  - `apps/web/test/accounts-youtube.test.ts`.

**Interfaces:**
- Produz o modelo `OAuthState { id String @id (32 bytes aleatórios base64url), provider String, organizationId Uuid, userId Uuid, codeVerifier String, expiresAt Timestamptz(3), createdAt }`.
- Produz `createOAuthState(db, { provider, organizationId, userId, ttlMs = 10 * 60_000 }): Promise<{ state: string; codeVerifier: string }>`.
- Produz `consumeOAuthState(db, { state, provider, userId }): Promise<{ organizationId: string; codeVerifier: string }>`.
  - O consumo é atômico (`DELETE … RETURNING`) e de uso único.
  - Lança `ValidationError('Autorização expirada ou inválida. Tente conectar de novo.')` quando o `state` não existe, está expirado ou pertence a outro usuário. No caso de outro usuário, o `state` também é apagado.
- Produz `createGoogleOAuth({ clientId, clientSecret, redirectUri, fetchFn = fetch })`, com os métodos:
  - **`authorizeUrl(state, codeVerifier): string`**:
    - endpoint `https://accounts.google.com/o/oauth2/v2/auth`;
    - parâmetros `response_type=code`, `access_type=offline`, `prompt=consent` (garante o `refresh_token` nas reconexões), `include_granted_scopes=true`, `code_challenge_method=S256`;
    - `code_challenge = base64url(sha256(codeVerifier))`;
    - os escopos das Restrições globais.
  - **`exchange(code, codeVerifier): Promise<{ refreshToken: string; accessToken: string; scopes: string[] }>`**:
    - `POST https://oauth2.googleapis.com/token`;
    - sem `refresh_token` na resposta, lança `PermanentError('O Google não devolveu acesso offline. Remova o acesso do app na sua conta Google e conecte de novo.')`.
  - **`myChannel(accessToken): Promise<{ channelId: string; title: string }>`**:
    - `GET https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true`;
    - sem itens na resposta, lança `PermanentError('Esta conta Google não tem canal do YouTube.')`.
  - **`revoke(refreshToken): Promise<void>`**: `POST https://oauth2.googleapis.com/revoke`.
- O `redirectUri` é `${APP_ORIGIN}/api/oauth/youtube/callback`, e esse endereço precisa estar cadastrado no Google Cloud. O runbook da Task 8 registra isso.
- Rotas:
  - **`GET …/accounts/youtube/start`**: exige `accounts.manage`, cria o `state` e responde com redirect 302 para o `authorizeUrl`.
  - **`GET /api/oauth/youtube/callback?code&state`**, ou `?error&state`:
    - exige sessão completa;
    - `consumeOAuthState`;
    - confere de novo `accounts.manage` na organização do `state`;
    - `exchange`, `myChannel`;
    - `upsertLinked({ platform: 'youtube', externalId: channelId, displayName: title, credential: { kind: 'google_oauth', refreshToken }, scopes })`;
    - redirect 302 para `/orgs/{orgId}/accounts?connected=youtube`.
  - Qualquer falha no callback (inclusive `error=access_denied` e 409) **não grava nada** e redireciona para `/orgs/{orgId}/accounts?error=<mensagem codificada>`. Quando o `state` é inválido e não se sabe a organização, redireciona para `/orgs?error=…`.
  - O `DELETE` de uma conta do YouTube (Task 4) passa a chamar `revoke` com o `refreshToken` decifrado.
  - Sem a configuração do Google, `start` responde 503 `'Integração com o Google não configurada.'`.

- [ ] **Step 1: Escrever os testes que falham.**
  - **`google-oauth.test.ts`:**
    - `'authorizeUrl inclui offline, consent, PKCE S256 e os dois escopos'`;
    - `'exchange sem refresh_token lança PermanentError'`;
    - `'myChannel sem itens lança PermanentError'`.
  - **`oauth-state.test.ts`:**
    - `'consome uma única vez'`: o segundo consumo lança `ValidationError`;
    - `'expirado lança e é apagado'`;
    - `'de outro usuário lança e é apagado'`.
- [ ] **Step 2: Rodar e ver falhar.** Comandos: `pnpm --filter @central/platforms test -- google-oauth` e `pnpm --filter @central/core test -- oauth-state`. Esperado: FALHA.
- [ ] **Step 3: Implementar** o modelo, a migração, `oauth-state.ts` e `google-oauth.ts`.
- [ ] **Step 4: Rodar e ver passar.** Esperado: PASSA.
- [ ] **Step 5: Escrever os testes de rota que falham em `accounts-youtube.test.ts`.** Os endpoints do Google são simulados por um servidor HTTP local, via as variáveis **só de teste** `GOOGLE_OAUTH_BASE_URL` e `YOUTUBE_API_BASE_URL`, ignoradas quando `NODE_ENV=production`.
  - `start` responde 302 com `state` e `code_challenge` na URL, e o `state` fica gravado.
  - O callback feliz cria a conta `youtube` com a credencial cifrada e redireciona para `?connected=youtube`.
  - O callback com um `state` reutilizado redireciona com `error` e não cria uma segunda conta.
  - O callback com `error=access_denied` redireciona com `error` e não cria nada.
  - O callback com um `state` criado por outro usuário redireciona com `error`.
  - Um canal já vinculado em outra organização redireciona com a mensagem de conflito.
  - O `DELETE` de uma conta do YouTube chama o endpoint de revogação simulado.
- [ ] **Step 6: Rodar, implementar as rotas e rodar de novo.** Comando: `pnpm test:web -- accounts-youtube`. Esperado: primeiro FALHA, depois PASSA.
- [ ] **Step 7: Commit.** Mensagem: `feat: conexão do canal do YouTube via OAuth`.

### Task 7: Telas de organizações, configurações e contas, e E2E

**Arquivos:**
- Criar:
  - `apps/web/app/components/OrgSwitcher.vue`;
  - `apps/web/app/composables/useOrgs.ts`;
  - `apps/web/app/pages/orgs/index.vue`;
  - `apps/web/app/pages/orgs/[orgId]/settings.vue`;
  - `apps/web/app/pages/orgs/[orgId]/accounts.vue`.
- Modificar:
  - `apps/web/app/layouts/default.vue` (seletor no topo e navegação "Contas" e "Configurações" da organização ativa);
  - `apps/web/app/pages/index.vue` (redireciona para a primeira organização, ou para `/orgs` se não houver nenhuma);
  - `apps/web/app/pages/admin/users.vue` (o seletor de "marca" vira de organização, usando `GET /api/orgs`);
  - `apps/web/e2e/*.spec.ts`.

**Interfaces:**
- Consome todas as rotas das Tasks 3 a 6.
- `useOrgs()` devolve `{ orgs: Ref<OrganizationSummary[]>, activeOrgId: Ref<string | null>, refresh() }`. A organização ativa vem do parâmetro `orgId` da rota. Fora de uma rota de organização, vale a última usada, lembrada em `localStorage` dentro de `try/catch`.
- Esboço das telas (spec §6):

  ```
  [GamerDoido ▾]  Contas | Configurações            (seletor no topo)
  Contas:  Instagram @gamerdoido  ✔ ativo   limite/dia [ 5 ]  [Desconectar]
           Facebook  GamerDoido   ✔ ativo   limite/dia [ — ]  [Desconectar]
           YouTube   GamerDoido   ⚠ reconectar               [Reconectar]
           TikTok    @gamerdoido  manual                      [Remover]
           [+ Meta (token do System User)] [+ YouTube] [+ TikTok (@)]
  ```

  - **Fluxo Meta na tela:**
    1. colar o token;
    2. clicar "Buscar Páginas";
    3. escolher a Página na lista, que mostra o IG vinculado ou "sem Instagram";
    4. clicar "Conectar".

    O token fica só no estado do componente e é apagado depois de conectar ou cancelar.
  - **YouTube:** o botão vai para `…/youtube/start`. Os parâmetros `?connected=` e `?error=` viram um aviso (toast/alert) na volta.
  - **`/orgs`:** lista de organizações. O admin global vê o botão "Nova organização" (nome, mais o slug opcional).
  - **Configurações:**
    - campos de nome, fuso, idioma e guia de voz;
    - tags e hashtags fixas, como chips;
    - modelo de créditos;
    - cortes: quantidade mínima e máxima, duração mínima e máxima;
    - orçamento de IA.
    - Os erros 422 aparecem por campo (`data.fields` do `toHttpError`).
  - Usuários sem `accounts.manage` ou `settings.manage` veem as telas em modo leitura, sem os botões de ação. A permissão real continua no servidor.

- [ ] **Step 1: Estender o E2E que falha**, em um novo `apps/web/e2e/orgs.spec.ts` com o admin semeado.
  - Criar a organização "GamerDoido".
  - Abrir "Configurações" e salvar as tags `#Games, PS5`. Ver os chips `games` e `ps5` depois de recarregar.
  - Abrir "Contas", vincular o TikTok `@GamerDoido` e ver `@gamerdoido` na lista.
  - Criar uma segunda organização "Academia" e trocar pelo seletor: a lista de contas fica vazia.
  - Tentar vincular `@gamerdoido` na Academia e ver a mensagem "Esta conta já está vinculada a outra organização.".
- [ ] **Step 2: Rodar e ver falhar.** Comando: `pnpm test:e2e`. Esperado: FALHA (as páginas não existem).
- [ ] **Step 3: Implementar as telas e o seletor.** Use os componentes Nuxt UI e os ícones lucide já empacotados. A CSP continua igual.
- [ ] **Step 4: Rodar e ver passar.** Comandos: `pnpm test:e2e`, `pnpm test:web`, `pnpm lint` e `pnpm typecheck`. Esperado: PASSA.
- [ ] **Step 5: Commit.** Mensagem: `feat(web): telas de organizações, configurações e contas vinculadas`.

### Task 8: Configuração, runbook do app Meta e documentação

**Arquivos:**
- Modificar:
  - `.env.example`;
  - `compose.yaml` e `compose.prod.yaml` (repassar `META_APP_ID`, `META_APP_SECRET`, `META_GRAPH_VERSION`, `GOOGLE_OAUTH_CLIENT_ID` e `GOOGLE_OAUTH_CLIENT_SECRET` ao web, todas opcionais, sem injetar string vazia);
  - `docs/runbooks/deploy.md`.
- Criar:
  - `docs/runbooks/meta-app.md`;
  - `docs/runbooks/google-oauth.md`;
  - `docs/adr/0008-cortador-hibrido.md`;
  - `docs/adr/0009-organizacoes-e-contas.md`;
  - `docs/adr/0010-trava-de-direitos.md`.
- Modificar também: `docs/00-visao-geral.md`, `docs/05-modelo-de-dados.md`, `docs/17-roadmap-e-criterios-de-aceite.md` e `docs/README.md`.

**Conteúdo exigido:**
- **`meta-app.md`** (em pt-BR, para o dono):
  - criar um app Meta do tipo Business no Business Manager que contém as Páginas;
  - adicionar os casos de uso de Instagram e Páginas;
  - criar um System User regular e atribuir a ele a Página e o IG com as tarefas de conteúdo;
  - gerar o token com os escopos `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `instagram_basic` e `instagram_content_publish` (docs/07, instagram.md e facebook.md);
  - **testar se o app pode ir para Live usando só Standard Access.** É o risco nº 1 do spec §10. Registrar o resultado no ADR 0009.
  - Se houver várias organizações em Business Managers diferentes, repetir o processo por Business Manager.
  - Onde guardar o token: o mesmo gerenciador de senhas da `APP_ENCRYPTION_KEYS`. Ele é colado uma única vez na tela.
- **`google-oauth.md`:**
  - criar o projeto no Google Cloud e ativar a YouTube Data API v3;
  - criar o cliente OAuth "Web" com o redirect `https://<PANEL_DOMAIN>/api/oauth/youtube/callback`;
  - configurar a tela de consentimento (External, uso pessoal com menos de 100 usuários, docs/07 youtube.md);
  - a cota padrão é de 10.000 unidades por dia, compartilhada por todas as organizações, e o formulário de aumento está em docs/07.
- **ADRs:** decisões do spec §8 (abordagem híbrida), §4 (organização, contas e conexão Meta por organização) e §5.2 (trava de direitos), cada uma com contexto, decisão, alternativas e consequências.
- **Documentos de visão e roteiro:**
  - `00`: sai o não-objetivo de cortes; entram a multi-organização e a trava de direitos.
  - `17`: o novo roteiro do spec §9 (Fase 2 organizações, 3 cortador e análise, 4 renderização, 5 publicação), com os critérios da Fase 2 iguais às tarefas deste plano.
  - `05`: as entidades novas e renomeadas.

- [ ] **Step 1: Validar a configuração.** Comando: `docker compose -f compose.prod.yaml --env-file .env.example config -q`, com `PANEL_DOMAIN` definido. Esperado: exit 0.
- [ ] **Step 2: Rodar o smoke.** Comando: `scripts/smoke.sh`. Esperado: `SMOKE OK`, porque sem `META_*`/`GOOGLE_*` o painel sobe normalmente.
- [ ] **Step 3: Escrever os documentos acima.** Depois rodar `pnpm format`. Esperado: limpo.
- [ ] **Step 4: Commit.** Mensagem: `docs: runbooks Meta e Google, ADRs 0008–0010 e roteiro atualizado`.

---

## Mapa de critérios de aceite → tarefas

| Critério (spec §11, parte desta fase) | Tarefa |
|---|---|
| O admin cria duas organizações e vincula IG, FB, YouTube e o @ do TikTok a cada uma | 3, 4, 5, 6, 7 |
| Uma organização não vê nada da outra (testado na API) | 3, 4 (Ponto de atenção 1) |
| Conta externa única por organização | 4, 5, 6 (Ponto de atenção 2) |
| Credenciais cifradas e nunca expostas | 2, 4 (Ponto de atenção 5) |
| Validação do app Meta Live (risco nº 1), executada pelo dono | 8 (runbook) |
