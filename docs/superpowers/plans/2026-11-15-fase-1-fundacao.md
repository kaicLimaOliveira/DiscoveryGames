# Fase 1 — Fundação: plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar a base executável da Central: monorepo, banco com identidade, fila transacional, login com 2FA e papéis, worker com heartbeat, health check, adaptador `fake`, Docker Compose e CI. Tudo verde e implantado uma vez na VPS.

**Architecture:** Monolito modular TypeScript num monorepo pnpm. `apps/web` (Nuxt 4: painel e API) e `apps/worker` (Node) dependem de `packages/core`. O `core` depende de `db`, `storage` e `platforms`, que dependem de `shared`. O PostgreSQL 17 é a fonte da verdade e também a fila (pg-boss, schema `pgboss`).

**Tech Stack:** Node 24, pnpm 10, TypeScript strict, Nuxt 4 + Nuxt UI + nuxt-auth-utils, Prisma 7 (`@prisma/adapter-pg`), pg-boss, zod, pino, `@node-rs/argon2`, `otpauth`, `@aws-sdk/client-s3`, Vitest, Testcontainers, Playwright, Docker Compose, Caddy, GitHub Actions.

**Spec:** [`docs/17-roadmap-e-criterios-de-aceite.md` §Fase 1](../../17-roadmap-e-criterios-de-aceite.md). Ler junto:
- [03 — Arquitetura](../../03-arquitetura.md)
- [04 — Tecnologias](../../04-tecnologias.md)
- [05 — Modelo de dados §2.1](../../05-modelo-de-dados.md)
- [13 — Segurança §2–3, §7](../../13-seguranca.md)
- [14 — Testes](../../14-testes.md)
- [07.0 §2 (PlatformAdapter)](../../07-integracoes/00-estrategia-e-abstracao.md)
- [ADR 0001](../../adr/)

**Objetivo de negócio:** monetização ([20](../../20-monetizacao.md)). A Fase 1 não implementa nada de monetização. A trilha paralela de credenciamento (canal de marca no YouTube, conta TikTok **pessoal**, PoC Meta) começa agora, fora do código.

## Global Constraints

- Node.js 24.x LTS. pnpm workspaces. TypeScript `strict: true` em todos os pacotes.
- Nomes dos pacotes: `@central/shared`, `@central/db`, `@central/storage`, `@central/platforms`, `@central/core`, `@central/web`, `@central/worker`.
- Regra de dependência: `apps → core → (db, storage, platforms) → shared`. `platforms` e `storage` não importam `db`. Nenhum pacote importa `apps/*`.
- PostgreSQL 17. IDs uuid v7 (`@default(uuid(7))`). Todas as tabelas com `createdAt`/`updatedAt` `timestamptz` UTC.
- pg-boss usa o schema `pgboss`, fora do Prisma.
- Senhas com **Argon2id** (`memoryCost: 19456` KiB, `timeCost: 2`, `parallelism: 1`, parâmetros OWASP). Senha mínima de 12 caracteres.
- 2FA TOTP obrigatório para `admin` global e para quem tem papel `approver`/`admin` em alguma marca. TOTP: SHA1, 6 dígitos, período de 30 s, janela ±1.
- Sessão em cookie selado (nuxt-auth-utils), `HttpOnly`, `Secure` (em produção) e `SameSite=Lax`, com 12 h deslizantes. Revogação ao trocar a senha (`User.sessionVersion`).
- Limite de login: 5 falhas em 15 min, por IP e por e-mail.
- Segredos cifrados com AES-256-GCM: IV aleatório de 12 bytes, chave de 32 bytes, AAD obrigatório, `keyVersion` no texto cifrado.
- Logs JSON (pino) com redação de `authorization`, `access_token`, `refresh_token`, `client_secret`, `code`, `password`, `cookie`, `totpSecret` e assinatura de URL pré-assinada (`X-Amz-Signature`).
- Erros de configuração listam **nomes** de variáveis inválidas, nunca valores.
- Textos da UI em pt-BR; identificadores de código em inglês.
- Cobertura de testes ≥ 80% em `core` e `platforms` (limite configurado no Vitest).
- Nenhum token ou segredo em respostas da API, no front-end ou no Git.

## Review Focus

1. **E-mail com maiúsculas ou espaços** (`" Admin@X.com "`) no cadastro e no login → é o mesmo usuário. O e-mail é normalizado com `trim().toLowerCase()`. Teste na Task 10.
2. **Usuário desativado com sessão ativa** → a próxima requisição autenticada retorna 401, sem esperar a sessão expirar. Teste na Task 12.
3. **Código TOTP reutilizado** dentro da mesma janela (replay) → recusado, via `User.totpLastUsedStep`. Teste nas Tasks 8 e 10.
4. **Admin desativa ou rebaixa o último admin global ativo** (inclusive a si mesmo) → recusado com `LastAdminError`, para que ninguém perca o acesso à central. Teste na Task 10.
5. **Banco, storage ou worker fora do ar** → `/api/health` responde 503 com o componente em falha, em vez de travar ou dar 500 genérico. O worker sem heartbeat há mais de 90 s conta como falha. Teste na Task 12.

---

## Estrutura de arquivos

```
/ (Discovery Games)
├─ package.json · pnpm-workspace.yaml · tsconfig.base.json · eslint.config.mjs · .prettierrc
├─ vitest.config.ts · .nvmrc · .gitignore · .env.example
├─ compose.yaml · compose.prod.yaml · Caddyfile
├─ docker/web.Dockerfile · docker/worker.Dockerfile
├─ .github/workflows/ci.yml · .github/workflows/images.yml
├─ docs/runbooks/deploy.md
├─ packages/shared/src/  config.ts · logger.ts · crypto.ts · errors.ts · queue.ts · index.ts
├─ packages/db/          prisma/schema.prisma · prisma.config.ts
│                        src/client.ts · src/queue/pgboss-queue.ts · src/heartbeat.ts · src/index.ts
│                        src/testing.ts   (subpath export @central/db/testing)
├─ packages/storage/src/ s3.ts · index.ts
├─ packages/platforms/src/ types.ts · registry.ts · fake/fake-adapter.ts · index.ts
├─ packages/core/src/    errors.ts · audit.ts
│                        auth/password.ts · auth/totp.ts · auth/rate-limiter.ts · auth/identity-service.ts
│                        authz/roles.ts · authz/actor.ts
│                        cli/bootstrap-admin.ts · index.ts
├─ apps/worker/src/      main.ts · heartbeat.ts · handlers/system.ts
└─ apps/web/             nuxt.config.ts · server/utils/services.ts · server/utils/auth.ts
                         server/middleware/01.origin.ts · server/middleware/02.session.ts
                         server/api/health.get.ts · server/api/auth/* · server/api/admin/*
                         app/pages/login.vue · 2fa.vue · index.vue · admin/users.vue · account.vue
                         app/middleware/auth.global.ts · e2e/*.spec.ts · test/*.test.ts
```

Os pacotes internos exportam o código-fonte TS (`"exports": { ".": "./src/index.ts" }`). O Nuxt compila os workspaces diretamente. O worker é empacotado com `tsup` (`noExternal: [/^@central\//]`).

---

### Task 1: Monorepo, ferramentas e configuração validada

**Files:**
- Create: arquivos da raiz listados acima (exceto compose/docker/workflows), `packages/shared/{package.json,tsconfig.json,vitest.config.ts}`, `packages/shared/src/config.ts`, `packages/shared/src/index.ts`
- Test: `packages/shared/test/config.test.ts`

**Interfaces:**
- Produces:
  - `loadConfig<S extends z.ZodTypeAny>(schema: S, env?: Record<string, string | undefined>): z.infer<S>`. Lança `ConfigError` com `.keys: string[]`.
  - `baseEnvSchema`: `NODE_ENV` (`development|test|production`, padrão `development`), `LOG_LEVEL` (padrão `info`), `DATABASE_URL` (url), `SENTRY_DSN` (opcional).
  - `storageEnvSchema`: `S3_ENDPOINT`, `S3_REGION` (padrão `auto`), `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE` (boolean, padrão `false`).
  - `cryptoEnvSchema`: `APP_ENCRYPTION_KEYS` transformado em `Map<number, Buffer>`.
  - `ConfigError extends Error`, exportado provisoriamente de `config.ts`. Vai para `errors.ts` na Task 6.

- [ ] **Step 1: Inicializar o repositório e o workspace**

  Rodar `git init` na raiz `Discovery Games/`. Criar o `.gitignore` com `node_modules`, `.env`, `.output`, `.nuxt`, `dist`, `coverage`, `src/generated`. Criar `pnpm-workspace.yaml` (`packages/*`, `apps/*`) e `.nvmrc` (`24`).

  Scripts da raiz:
  - `lint`: `eslint .`
  - `format`: `prettier --check .`
  - `typecheck`: `pnpm -r typecheck`
  - `test`: `vitest run`
  - `test:web`: `pnpm --filter @central/web test`

  O `vitest.config.ts` da raiz usa `test.projects: ['packages/*', 'apps/worker']`.

- [ ] **Step 2: Escrever o teste que falha**

```ts
// packages/shared/test/config.test.ts
import { describe, it, expect } from 'vitest'
import { loadConfig, baseEnvSchema, cryptoEnvSchema, ConfigError } from '../src'

const key = (b: number) => Buffer.alloc(32, b).toString('base64')

describe('loadConfig', () => {
  it('aplica padrões', () => {
    const c = loadConfig(baseEnvSchema, { DATABASE_URL: 'postgres://u:p@h:5432/d' })
    expect(c.NODE_ENV).toBe('development')
    expect(c.LOG_LEVEL).toBe('info')
  })
  it('lista nomes inválidos sem vazar valores', () => {
    try { loadConfig(baseEnvSchema, { DATABASE_URL: 'segredo-nao-url' }); expect.fail() }
    catch (e) {
      expect(e).toBeInstanceOf(ConfigError)
      expect((e as ConfigError).keys).toEqual(['DATABASE_URL'])
      expect((e as Error).message).not.toContain('segredo-nao-url')
    }
  })
  it('APP_ENCRYPTION_KEYS vira mapa versão→chave de 32 bytes', () => {
    const c = loadConfig(cryptoEnvSchema, { APP_ENCRYPTION_KEYS: `1:${key(1)},2:${key(2)}` })
    expect([...c.APP_ENCRYPTION_KEYS.keys()]).toEqual([1, 2])
    expect(c.APP_ENCRYPTION_KEYS.get(2)!.length).toBe(32)
  })
  it.each(['', '1:abc', `x:${key(1)}`, `1:${key(1)},1:${key(2)}`])('rejeita APP_ENCRYPTION_KEYS=%j', (v) => {
    expect(() => loadConfig(cryptoEnvSchema, { APP_ENCRYPTION_KEYS: v })).toThrow(ConfigError)
  })
})
```

- [ ] **Step 3: Rodar e ver falhar.** Comando: `pnpm vitest run packages/shared`. Esperado: FAIL, módulo `../src` sem exports.
- [ ] **Step 4: Implementar `config.ts`.** Usar `safeParse`. `keys` vem de `issue.path[0]`, sem duplicatas e na ordem. A mensagem é `Configuração inválida: <keys>`. Chave com versão repetida, versão não inteira positiva ou que não decodifica para 32 bytes gera issue.
- [ ] **Step 5: Rodar e ver passar.** Rodar `pnpm vitest run packages/shared && pnpm lint && pnpm typecheck`. Esperado: PASS.
- [ ] **Step 6: Commit.** `git add -A && git commit -m "chore: monorepo e configuração validada"`

### Task 2: Logger estruturado com redação

**Files:**
- Create: `packages/shared/src/logger.ts`
- Test: `packages/shared/test/logger.test.ts`

**Interfaces:**
- Produces:
  - `type LogContext = { requestId?: string; jobId?: string; contentId?: string; publicationId?: string; platform?: string; userId?: string }`
  - `createLogger(opts: { name: string; level?: string; destination?: pino.DestinationStream }): pino.Logger`
  - `withContext(logger: pino.Logger, ctx: LogContext): pino.Logger`
  - `REDACT_PATHS: string[]`

- [ ] **Step 1: Escrever o teste que falha**

```ts
it('redige segredos em qualquer profundidade e mantém contexto', () => {
  const lines: string[] = []
  const log = withContext(createLogger({ name: 't', destination: { write: (s: string) => lines.push(s) } }), { requestId: 'r1', jobId: 'j1' })
  log.info({ headers: { authorization: 'Bearer AAA', cookie: 'c=1' }, body: { password: 'p', access_token: 'tok', refresh_token: 'rt', client_secret: 'cs', code: 'oc', totpSecret: 'ts' }, url: 'https://x/o?X-Amz-Signature=abc123&a=1' }, 'msg')
  const out = lines.join('')
  for (const s of ['Bearer AAA', 'c=1', '"p"', 'tok', 'rt', 'cs', '"oc"', 'ts"', 'abc123']) expect(out).not.toContain(s)
  const j = JSON.parse(lines[0]!)
  expect(j.requestId).toBe('r1'); expect(j.jobId).toBe('j1'); expect(j.name).toBe('t')
})
```

- [ ] **Step 2: Rodar e ver falhar.** Comando: `pnpm vitest run packages/shared/test/logger.test.ts`. Esperado: FAIL.
- [ ] **Step 3: Implementar.** Usar `redact` do pino com caminhos curinga (`*.password`, `*.*.password` etc., para cada nome das Global Constraints) e `censor: '[REDACTED]'`. Para URL, um serializador `formatters.log` troca o valor de `X-Amz-Signature=` por `[REDACTED]` em strings de primeiro e segundo nível.
- [ ] **Step 4: Rodar e ver passar.**
- [ ] **Step 5: Commit.** `feat(shared): logger com redação`

### Task 3: Cifragem de segredos (AES-256-GCM)

**Files:**
- Create: `packages/shared/src/crypto.ts`
- Test: `packages/shared/test/crypto.test.ts`

**Interfaces:**
- Consumes: `Map<number, Buffer>` vindo de `cryptoEnvSchema` (Task 1).
- Produces:
  - `createCipher(keys: Map<number, Buffer>): SecretCipher`
  - `interface SecretCipher { currentVersion: number; encrypt(plain: string, aad: string): string; decrypt(token: string, aad: string): string; needsRotation(token: string): boolean }`
  - Formato do token: `` `${version}.${b64url(iv)}.${b64url(tag)}.${b64url(ciphertext)}` ``

- [ ] **Step 1: Escrever os testes que falham**

```ts
const k = (b: number) => Buffer.alloc(32, b)
it('round-trip com a maior versão', () => {
  const c = createCipher(new Map([[1, k(1)], [2, k(2)]]))
  const t = c.encrypt('segredo', 'user:1:totp')
  expect(t.startsWith('2.')).toBe(true)
  expect(c.decrypt(t, 'user:1:totp')).toBe('segredo')
})
it('IV único por valor', () => {
  const c = createCipher(new Map([[1, k(1)]]))
  expect(c.encrypt('x', 'a')).not.toBe(c.encrypt('x', 'a'))
})
it('AAD diferente falha (impede trocar cifrados entre linhas)', () => {
  const c = createCipher(new Map([[1, k(1)]]))
  expect(() => c.decrypt(c.encrypt('x', 'user:1'), 'user:2')).toThrow()
})
it('decifra versão antiga e sinaliza rotação', () => {
  const old = createCipher(new Map([[1, k(1)]])).encrypt('x', 'a')
  const c = createCipher(new Map([[1, k(1)], [2, k(2)]]))
  expect(c.decrypt(old, 'a')).toBe('x'); expect(c.needsRotation(old)).toBe(true)
})
it('versão desconhecida ou token adulterado lança erro', () => {
  const c = createCipher(new Map([[1, k(1)]]))
  expect(() => c.decrypt('9.a.b.c', 'a')).toThrow(/versão/)
  const t = c.encrypt('x', 'a'); expect(() => c.decrypt(t.slice(0, -2) + 'AA', 'a')).toThrow()
})
```

- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar com `node:crypto`.** Usar `createCipheriv('aes-256-gcm', key, randomBytes(12))`, `setAAD(Buffer.from(aad))` e `getAuthTag()`.
- [ ] **Step 4: Rodar e ver passar.**
- [ ] **Step 5: Commit.** `feat(shared): cifragem AES-256-GCM com versão de chave`

### Task 4: Pacote `db`, schema de identidade e helper de testes

**Files:**
- Create:
  - `packages/db/package.json` (scripts `generate`, `migrate:dev`, `migrate:deploy`, `typecheck`)
  - `packages/db/prisma.config.ts`, `packages/db/prisma/schema.prisma`, `packages/db/prisma/migrations/*`
  - `packages/db/src/client.ts`, `packages/db/src/testing.ts`, `packages/db/src/index.ts`
- Test: `packages/db/test/schema.test.ts`

**Interfaces:**
- Produces:
  - `createPrisma(databaseUrl: string): PrismaClient`, via `PrismaPg` adapter.
  - Tipos: `type Db = PrismaClient`, `type Tx = Prisma.TransactionClient`, `type DbOrTx = Db | Tx`.
  - Reexporta os enums `GlobalRole`, `UserStatus`, `BrandRole` e os tipos de modelo.
  - `@central/db/testing`: `startTestDatabase(): Promise<{ url: string; prisma: PrismaClient; stop(): Promise<void> }>`. Sobe `postgres:17` via Testcontainers e roda `prisma migrate deploy`.

**Modelos** (campos de [05 §2.1](../../05-modelo-de-dados.md), mais o que esta fase decide):

| Modelo | Campos |
|---|---|
| `User` | `id`, `email @unique` (sempre minúsculo), `name`, `passwordHash`, `totpSecretEnc String?`, `totpEnabledAt DateTime?`, `totpLastUsedStep BigInt?`, `role GlobalRole @default(member)`, `status UserStatus @default(active)`, `sessionVersion Int @default(1)`, `lastLoginAt DateTime?` |
| `Brand` | `id`, `name`, `slug @unique`, `timezone @default("America/Sao_Paulo")`, `locale @default("pt-BR")`, `voiceGuide Json @default("{}")`, `aiMonthlyBudgetUsd Decimal? @db.Decimal(10,2)`, `active Boolean @default(true)` |
| `BrandMember` | `brandId`, `userId`, `role BrandRole`; `@@id([brandId, userId])` |
| `Setting` | `id`, `brandId String?`, `key`, `value Json` |
| `AuditLog` | `id`, `brandId?`, `userId?`, `action`, `entityType`, `entityId?`, `diff Json?`, `ip?`, `at @default(now())`; `@@index([brandId, at])` |
| `Heartbeat` | `name String @id`, `at DateTime` |

Enums:
- `GlobalRole`: `admin`, `member`
- `UserStatus`: `active`, `disabled`
- `BrandRole`: `viewer`, `editor`, `approver`, `admin`

Na migração inicial, acrescentar SQL manual: `CREATE UNIQUE INDEX "Setting_brandId_key_key" ON "Setting" ("brandId", "key") NULLS NOT DISTINCT;`. O Prisma não expressa `NULLS NOT DISTINCT`, e sem isso a mesma configuração global poderia existir duplicada.

- [ ] **Step 1: Escrever os testes que falham**

```ts
let db: Awaited<ReturnType<typeof startTestDatabase>>
beforeAll(async () => { db = await startTestDatabase() }, 120_000)
afterAll(() => db.stop())

it('gera uuid v7 e timestamps', async () => {
  const b = await db.prisma.brand.create({ data: { name: 'B', slug: 'b' } })
  expect(b.id[14]).toBe('7'); expect(b.timezone).toBe('America/Sao_Paulo'); expect(b.createdAt).toBeInstanceOf(Date)
})
it('Setting global é único mesmo com brandId nulo', async () => {
  await db.prisma.setting.create({ data: { key: 'k', value: 1 } })
  await expect(db.prisma.setting.create({ data: { key: 'k', value: 2 } })).rejects.toThrow()
})
it('BrandMember tem PK composta', async () => {
  const u = await db.prisma.user.create({ data: { email: 'a@x.com', name: 'A', passwordHash: 'h' } })
  const b = await db.prisma.brand.create({ data: { name: 'C', slug: 'c' } })
  await db.prisma.brandMember.create({ data: { brandId: b.id, userId: u.id, role: 'editor' } })
  await expect(db.prisma.brandMember.create({ data: { brandId: b.id, userId: u.id, role: 'viewer' } })).rejects.toThrow()
})
```

- [ ] **Step 2: Rodar e ver falhar.** Comando: `pnpm vitest run packages/db`. Esperado: FAIL.
- [ ] **Step 3: Escrever o schema e criar a migração.** Rodar `pnpm --filter @central/db migrate:dev --name identity` contra um Postgres local. Usar generator `prisma-client` com saída em `src/generated/prisma`. Acrescentar o índice `NULLS NOT DISTINCT` no SQL da migração.
- [ ] **Step 4: Implementar `client.ts` e `testing.ts`.**
- [ ] **Step 5: Rodar e ver passar.** Também confirmar que `prisma migrate deploy` funciona em banco vazio.
- [ ] **Step 6: Commit.** `feat(db): schema de identidade e helper Testcontainers`

### Task 5: Fila transacional (pg-boss) e heartbeat

**Files:**
- Create: `packages/shared/src/queue.ts`, `packages/db/src/queue/pgboss-queue.ts`, `packages/db/src/heartbeat.ts`
- Test: `packages/db/test/queue.test.ts`, `packages/db/test/heartbeat.test.ts`

**Interfaces:**
- Consumes: `Db`, `Tx` e `startTestDatabase` (Task 4).
- Produces em `@central/shared`:
  - `type SqlExecutor = { executeSql(text: string, values?: unknown[]): Promise<{ rows: unknown[] }> }`
  - `interface SendOptions { db?: SqlExecutor; singletonKey?: string; startAfter?: Date }`
  - `interface JobQueue { send(name: QueueName, data: object, opts?: SendOptions): Promise<string | null> }`
  - `const QUEUES = { systemEcho: 'system.echo' } as const; type QueueName = typeof QUEUES[keyof typeof QUEUES]`
- Produces em `@central/db`:
  - `sqlExecutorFor(tx: Tx): SqlExecutor`, que embrulha `tx.$queryRawUnsafe(text, ...values)` em `{ rows }`.
  - `createPgBossQueue(opts: { connectionString: string; role: 'web' | 'worker' }): Promise<PgBossQueue>`
  - `PgBossQueue implements JobQueue`, com `work<T>(name: QueueName, handler: (job: { id: string; data: T }) => Promise<void>, opts?: { concurrency?: number }): Promise<void>`, `stop(): Promise<void>` e `ping(): Promise<void>`.
  - `recordHeartbeat(db: DbOrTx, name: string, at?: Date): Promise<void>` (upsert)
  - `readHeartbeat(db: DbOrTx, name: string): Promise<Date | null>`

- [ ] **Step 1: Escrever os testes que falham**

```ts
it('job enviado dentro da transação some no rollback', async () => {
  const q = await createPgBossQueue({ connectionString: db.url, role: 'worker' })
  await expect(db.prisma.$transaction(async (tx) => {
    await tx.brand.create({ data: { name: 'R', slug: 'r' } })
    await q.send(QUEUES.systemEcho, { n: 1 }, { db: sqlExecutorFor(tx) })
    throw new Error('rollback')
  })).rejects.toThrow('rollback')
  expect(await db.prisma.brand.count({ where: { slug: 'r' } })).toBe(0)
  const rows = await db.prisma.$queryRawUnsafe<unknown[]>(`select 1 from pgboss.job where name = 'system.echo'`)
  expect(rows).toHaveLength(0)
})
it('job enviado na transação confirmada é processado', async () => {
  const q = await createPgBossQueue({ connectionString: db.url, role: 'worker' })
  const seen = new Promise<object>((res) => q.work(QUEUES.systemEcho, async (j) => res(j.data)))
  await db.prisma.$transaction(async (tx) => q.send(QUEUES.systemEcho, { n: 2 }, { db: sqlExecutorFor(tx) }))
  await expect(seen).resolves.toEqual({ n: 2 })
  await q.stop()
})
it('singletonKey deduplica', async () => { /* duas sends com o mesmo singletonKey → segunda retorna null */ })
```

  Heartbeat: `recordHeartbeat(db, 'worker', t1)` seguido de `recordHeartbeat(db, 'worker', t2)` faz `readHeartbeat` retornar `t2`. Nome inexistente retorna `null`.

- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar.**
  - Criar o PgBoss com `schema: 'pgboss'`.
  - `role: 'web'` desliga a supervisão e o agendamento. `role: 'worker'` habilita as migrações do pg-boss. Conferir os nomes exatos dessas opções na documentação da versão instalada.
  - `createPgBossQueue` chama `createQueue` para cada valor de `QUEUES`, de forma idempotente.
  - `ping` executa `select 1` pelo pg-boss.
- [ ] **Step 4: Rodar e ver passar.**
- [ ] **Step 5: Commit.** `feat(db): fila pg-boss transacional e heartbeat`

### Task 6: Storage S3 e hierarquia de erros

**Files:**
- Create: `packages/storage/src/s3.ts`, `packages/storage/src/index.ts`, `packages/shared/src/errors.ts`
- Modify: `packages/shared/src/config.ts` (passar a importar `ConfigError` de `errors.ts`)
- Test: `packages/storage/test/s3.test.ts`, `packages/shared/test/errors.test.ts`

**Interfaces:**
- Produces em `@central/storage`:
  - `createStorage(cfg: z.infer<typeof storageEnvSchema>): Storage`
  - `interface Storage { ping(): Promise<void> }`. `ping` executa `HeadBucket` e lança erro se o bucket não existir ou se as credenciais forem inválidas.
- Produces em `@central/shared`:
  - `AppError extends Error` (`code: string`)
  - `TransientError`, `RateLimitError` (`retryAfterMs: number`), `AuthError`, `PermanentError`, `PolicyError`, `UnknownOutcomeError`, `ConfigError` (`keys: string[]`)
  - Todos com `name` igual ao nome da classe e `instanceof AppError`.

- [ ] **Step 1: Escrever os testes que falham**
  - Subir um container MinIO pelo Testcontainers e criar o bucket `test`. `ping()` resolve.
  - Bucket `inexistente` faz o `ping` rejeitar.
  - `new RateLimitError('x', 5000).retryAfterMs === 5000` e `instanceof AppError`.
- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar.** O storage usa `S3Client` com `forcePathStyle` vindo da configuração.
- [ ] **Step 4: Rodar e ver passar.**
- [ ] **Step 5: Commit.** `feat(storage): cliente S3 com ping; erros de domínio`

### Task 7: Contrato `PlatformAdapter`, registro e adaptador `fake`

**Files:**
- Create: `packages/platforms/src/types.ts`, `packages/platforms/src/registry.ts`, `packages/platforms/src/fake/fake-adapter.ts`, `packages/platforms/src/index.ts`, `packages/platforms/vitest.config.ts` (cobertura ≥ 80%)
- Test: `packages/platforms/test/registry.test.ts`, `packages/platforms/test/fake-adapter.test.ts`

**Interfaces:**
- Consumes: erros de `@central/shared` (Task 6).
- Produces, todos os membros de [07.0 §2](../../07-integracoes/00-estrategia-e-abstracao.md) tipados:

```ts
export type PlatformId = 'instagram' | 'facebook' | 'tiktok' | 'youtube' | 'fake'
export type PublicationFormat = 'reel' | 'short' | 'video' | 'carousel' | 'image'
export type PublishProgress = Record<string, unknown>
export interface PublishContext { publicationId: string; idempotencyKey: string; account: { id: string; externalId: string }; format: PublicationFormat; caption: string; title?: string; mediaPath?: string; options: Record<string, unknown> }
export interface PublishStepResult { progress: PublishProgress; done: boolean; externalId?: string; externalUrl?: string }
export type ReconcileResult = { status: 'found'; externalId: string; externalUrl?: string } | { status: 'not_found' } | { status: 'inconclusive' }
export interface VideoConstraints { minDurationSec?: number; maxDurationSec: number; aspectRatios: string[]; maxSizeBytes?: number; containers: string[]; videoCodecs: string[]; audioCodecs: string[]; source: { url: string; checkedAt: string } }
export interface TextRules { captionMax?: number; titleMax?: number; unit: 'chars' | 'bytes'; maxHashtags?: number; required: Array<'caption' | 'title'> }
export interface PlatformAdapter {
  id: PlatformId
  mode: 'api' | 'manual'
  capabilities(account: PublishContext['account']): { formats: PublicationFormat[]; supportsNativeSchedule: boolean; uploadModes: Array<'bytes' | 'url'>; metrics: string[] }
  videoConstraints(format: PublicationFormat): VideoConstraints
  textRules(format: PublicationFormat): TextRules
  optionsSchema(format: PublicationFormat): z.ZodTypeAny
  oauth?: { authorizeUrl(state: string, codeChallenge?: string): string; exchange(code: string, codeVerifier?: string): Promise<unknown>; refresh(cred: unknown): Promise<unknown>; revoke(cred: unknown): Promise<void> }
  preflight(ctx: PublishContext): Promise<void>
  publishStep(ctx: PublishContext, progress: PublishProgress): Promise<PublishStepResult>
  reconcile(ctx: PublishContext, progress: PublishProgress): Promise<ReconcileResult>
  fetchMetrics(account: PublishContext['account'], externalIds: string[]): Promise<Array<{ externalId: string; views: number | null; likes: number | null; raw: unknown }>>
  classifyError(err: unknown): Error
}
```

  Os membros `listConnectableAccounts`, `healthCheck`, `fetchAccountMetrics` e `quotaState` entram nas Fases 5 e 9. Registrar como comentário `// Fase 5/9` no `types.ts`, para o contrato completo ficar visível.

  Também produz:
  - `createPlatformRegistry(): { register(a: PlatformAdapter): void; get(id: PlatformId): PlatformAdapter; list(): PlatformAdapter[] }`. `get` de id desconhecido e `register` duplicado lançam erro.
  - `createFakeAdapter(opts?: FakeOptions): PlatformAdapter & { published: Map<string, string> }`
  - `FakeOptions = { steps?: number /* padrão 3 */; failAt?: { step: number; kind: 'transient' | 'rate_limit' | 'auth' | 'permanent' | 'unknown_outcome'; times?: number /* padrão 1 */ } }`

- [ ] **Step 1: Escrever os testes que falham**

```ts
it('publica em N passos com progress acumulado e externalId estável', async () => {
  const a = createFakeAdapter({ steps: 3 }); let p = {}; let r
  for (let i = 0; i < 3; i++) { r = await a.publishStep(ctx, p); p = r.progress }
  expect(r!.done).toBe(true); expect(r!.externalId).toBe(`fake_${ctx.idempotencyKey}`)
  expect(a.published.size).toBe(1)
})
it('retomar a partir do progress não repete passos já feitos', async () => { /* passo 1, depois nova instância com o mesmo `published` continua do progress → 1 publicação */ })
it.each([['transient', TransientError], ['rate_limit', RateLimitError], ['auth', AuthError], ['permanent', PermanentError], ['unknown_outcome', UnknownOutcomeError]])('falha %s no passo configurado', async (kind, Cls) => {
  const a = createFakeAdapter({ failAt: { step: 2, kind: kind as never } })
  const r1 = await a.publishStep(ctx, {})
  await expect(a.publishStep(ctx, r1.progress)).rejects.toBeInstanceOf(Cls)
  await expect(a.publishStep(ctx, r1.progress)).resolves.toBeTruthy() // times=1
})
it('unknown_outcome no último passo publica de fato; reconcile encontra', async () => {
  const a = createFakeAdapter({ steps: 2, failAt: { step: 2, kind: 'unknown_outcome' } })
  const r1 = await a.publishStep(ctx, {}); await expect(a.publishStep(ctx, r1.progress)).rejects.toBeInstanceOf(UnknownOutcomeError)
  expect(await a.reconcile(ctx, r1.progress)).toMatchObject({ status: 'found' })
})
it('classifyError mantém erros de domínio e trata desconhecido como Transient', () => { /* ... */ })
it('registro rejeita duplicado e id desconhecido', () => { /* ... */ })
```

- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar.** O fake guarda `published` por `idempotencyKey`. Em `unknown_outcome`, ele registra a publicação **e depois** lança o erro, simulando um timeout após sucesso. As constraints do fake são `maxDurationSec: 180`, `aspectRatios: ['9:16']` e `source.url: 'fake://'`.
- [ ] **Step 4: Rodar e ver passar** (com cobertura). Comando: `pnpm vitest run packages/platforms --coverage`.
- [ ] **Step 5: Commit.** `feat(platforms): contrato PlatformAdapter, registro e adaptador fake`

### Task 8: Primitivas de autenticação (senha, TOTP, limite de tentativas)

**Files:**
- Create: `packages/core/{package.json,tsconfig.json,vitest.config.ts}` (cobertura ≥ 80%), `packages/core/src/auth/password.ts`, `packages/core/src/auth/totp.ts`, `packages/core/src/auth/rate-limiter.ts`
- Test: `packages/core/test/auth/{password,totp,rate-limiter}.test.ts`

**Interfaces:**
- Produces:
  - `hashPassword(plain: string): Promise<string>`, `verifyPassword(hash: string, plain: string): Promise<boolean>`
  - `generateTotpSecret(): string` (base32, 20 bytes)
  - `totpUri(secret: string, label: string, issuer: string): string`
  - `verifyTotp(secret: string, code: string, lastUsedStep: bigint | null, now?: Date): { ok: true; step: bigint } | { ok: false }`
  - `createLoginRateLimiter(opts?: { max?: number /* 5 */; windowMs?: number /* 900_000 */; now?: () => number }): LoginRateLimiter`
  - `interface LoginRateLimiter { retryAfterMs(keys: string[]): number /* 0 = liberado */; recordFailure(keys: string[]): void; reset(key: string): void }`

- [ ] **Step 1: Escrever os testes que falham**

  Senha:
  - O hash começa com `$argon2id$v=19$m=19456,t=2,p=1$`.
  - `verifyPassword` acerta com a senha certa e falha com a errada.

  TOTP:
  - Gerar o código com `otpauth` em `now`: `verifyTotp` aceita em `now`, `now+30s` e `now-30s`, e recusa em `now+90s`.
  - **Replay:** o mesmo código com `lastUsedStep` igual ao `step` retornado vira `{ ok: false }`.
  - Código fora do formato de 6 dígitos vira `{ ok: false }`.

  Limitador:
  - 5 `recordFailure(['ip:1', 'email:a'])`: `retryAfterMs(['email:a']) > 0`.
  - Depois de `now` avançar 15 min, volta para `0`.
  - `reset('email:a')` libera o e-mail, mas não o IP.

- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar.** Usar `@node-rs/argon2` (`algorithm: Algorithm.Argon2id`) e `otpauth` (`TOTP.validate({ token, timestamp, window: 1 })`; o step é `floor(timestamp/30000) + delta`). O limitador fica em memória, num `Map` com janela deslizante, porque a Fase 1 roda uma única réplica do web. Registrar essa limitação num comentário.
- [ ] **Step 4: Rodar e ver passar.**
- [ ] **Step 5: Commit.** `feat(core): senha argon2id, TOTP anti-replay e limite de login`

### Task 9: Autorização por papel e auditoria

**Files:**
- Create: `packages/core/src/authz/roles.ts`, `packages/core/src/authz/actor.ts`, `packages/core/src/audit.ts`, `packages/core/src/errors.ts`
- Test: `packages/core/test/authz/roles.test.ts`, `packages/core/test/authz/actor.test.ts`, `packages/core/test/audit.test.ts`

**Interfaces:**
- Produces:
  - `type Action = 'library.read' | 'content.edit' | 'publication.approve' | 'publishing.pause' | 'accounts.manage' | 'settings.manage' | 'users.manage'`
  - `const ACTION_MIN_ROLE: Record<Action, BrandRole>`, conforme a matriz de [13 §3](../../13-seguranca.md):
    - `library.read` → `viewer`
    - `content.edit` → `editor`
    - `publication.approve` e `publishing.pause` → `approver`
    - os demais → `admin`
  - `type Actor = { userId: string; globalRole: GlobalRole; memberships: Array<{ brandId: string; role: BrandRole }> }`
  - `can(actor: Actor, brandId: string | null, action: Action): boolean`. Global admin pode tudo. `brandId: null` só vale para global admin. A ordem dos papéis é `viewer < editor < approver < admin`.
  - `requires2fa(actor: Actor): boolean`
  - `loadActor(db: DbOrTx, userId: string): Promise<(Actor & { sessionVersion: number }) | null>`. Retorna `null` se o usuário não existir ou estiver `disabled`.
  - `writeAudit(db: DbOrTx, e: { action: string; entityType: string; entityId?: string; userId?: string; brandId?: string; diff?: unknown; ip?: string }): Promise<void>`
  - `errors.ts`: `DomainError extends AppError`, `InvalidCredentialsError`, `TooManyAttemptsError` (`retryAfterMs`), `InvalidTotpError`, `ForbiddenError`, `ConflictError`, `LastAdminError`, `ValidationError`.

- [ ] **Step 1: Escrever os testes que falham**
  - Tabela com todas as combinações de papel × `Action`, conferindo `can` contra a matriz de 13 §3. O teste é gerado com `it.each` a partir de uma tabela literal no próprio teste, **não** a partir de `ACTION_MIN_ROLE`.
  - Um membro de uma marca não pode agir em outra marca.
  - `requires2fa`: `admin` global → true. Approver numa marca → true. Só editor/viewer → false.
  - `loadActor` com usuário `disabled` → `null`.
  - `writeAudit` dentro de uma transação revertida não deixa linha.
- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar e ver passar.**
- [ ] **Step 5: Commit.** `feat(core): autorização por papel e auditoria`

### Task 10: Serviço de identidade e bootstrap do admin

**Files:**
- Create: `packages/core/src/auth/identity-service.ts`, `packages/core/src/cli/bootstrap-admin.ts`, `packages/core/src/index.ts`
- Test: `packages/core/test/auth/identity-service.test.ts`, `packages/core/test/cli/bootstrap-admin.test.ts`

**Interfaces:**
- Consumes: Tasks 3, 4, 8 e 9.
- Produces:
  - `createIdentityService(deps: { db: Db; cipher: SecretCipher; limiter: LoginRateLimiter; totpIssuer: string; now?: () => Date }): IdentityService`
  - `type LoginStage = 'full' | 'totp_pending' | 'totp_enroll'`
  - `interface IdentityService`:
    - `login(i: { email: string; password: string; ip: string }): Promise<{ userId: string; stage: LoginStage; sessionVersion: number }>`
    - `verifyLoginTotp(userId: string, code: string): Promise<void>`
    - `startTotpEnrollment(userId: string): Promise<{ secret: string; uri: string }>`
    - `confirmTotpEnrollment(userId: string, secret: string, code: string): Promise<void>`
    - `changePassword(userId: string, current: string, next: string): Promise<{ sessionVersion: number }>`
    - `createUser(actor: Actor, i: { email: string; name: string; password: string; globalRole?: GlobalRole }): Promise<{ id: string }>`
    - `updateUser(actor: Actor, userId: string, i: { status?: UserStatus; globalRole?: GlobalRole; name?: string }): Promise<void>`
    - `setMembership(actor: Actor, brandId: string, userId: string, role: BrandRole | null): Promise<void>`
    - `listUsers(actor: Actor): Promise<Array<{ id: string; email: string; name: string; role: GlobalRole; status: UserStatus; totpEnabled: boolean; memberships: Array<{ brandId: string; role: BrandRole }> }>>`
  - `bootstrapAdmin(db: Db, i: { email: string; name: string; brandName: string; brandSlug: string }): Promise<{ password: string }>`. Gera uma senha de 20 caracteres e lança `ConflictError` se já existir algum admin global. A CLI usa `node:util` `parseArgs` e roda com `pnpm bootstrap:admin -- --email … --name … --brand-name … --brand-slug …`.

**Regras** (vêm da spec ou são decididas aqui):
- O e-mail é normalizado (`trim().toLowerCase()`) em `login` e `createUser`.
- `login` recusa usuário `disabled`, senha errada ou bloqueio do limitador com `InvalidCredentialsError` ou `TooManyAttemptsError`, usando a mesma mensagem genérica para e-mail inexistente e senha errada. O limitador usa as chaves `ip:<ip>` e `email:<email>`.
- `stage = requires2fa ? (totpEnabledAt ? 'totp_pending' : 'totp_enroll') : 'full'`. Usuário fora do 2FA obrigatório que ativou TOTP também cai em `totp_pending`.
- O TOTP é salvo com `cipher.encrypt(secret, \`user:${id}:totp\`)`. Cada verificação aceita grava `totpLastUsedStep`.
- `changePassword` exige a senha atual e mínimo de 12 caracteres, e incrementa `sessionVersion`.
- `createUser`, `updateUser` e `setMembership` exigem `can(actor, null, 'users.manage')`; sem isso, lançam `ForbiddenError`.
- `updateUser` lança `LastAdminError` se a mudança deixar zero admins globais `active`.
- Auditoria: `auth.login`, `auth.login_failed`, `auth.totp_enabled`, `auth.password_changed`, `user.created`, `user.updated`, `member.upserted`, `member.removed`. O `diff` nunca contém hash nem segredo.

- [ ] **Step 1: Escrever os testes que falham** (Testcontainers, `now` controlado)
  - Login:
    - `createUser` com `' Ana@X.com '` seguido de `login` com `'ana@x.com'` → ok. Criar `'ANA@x.com'` de novo → `ConflictError`.
    - Editor → `stage: 'full'`. Approver sem TOTP → `'totp_enroll'`. Approver com TOTP → `'totp_pending'`.
    - Seis senhas erradas → a sexta tentativa lança `TooManyAttemptsError`, inclusive com a senha certa.
    - E-mail inexistente e senha errada produzem a mesma mensagem.
  - TOTP:
    - `confirmTotpEnrollment` com código errado → `InvalidTotpError`. Com código certo → `totpEnabledAt` preenchido e `totpSecretEnc` diferente do segredo em claro.
    - **Replay:** um código aceito em `verifyLoginTotp` é recusado na segunda chamada no mesmo período.
  - Senha e permissões:
    - `changePassword` incrementa `sessionVersion` e a senha antiga deixa de funcionar.
    - **Último admin:** com um único admin, `updateUser(admin, admin.id, { status: 'disabled' })` → `LastAdminError`. Com dois admins → permitido.
    - Editor chamando `createUser` → `ForbiddenError`.
  - Auditoria: `AuditLog` contém `auth.login_failed` e `user.created`, e nenhum `diff` contém `passwordHash`.
  - Bootstrap: cria a marca e o admin. A segunda execução → `ConflictError`.
- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar.** Mudança de estado e auditoria acontecem na mesma `$transaction`.
- [ ] **Step 4: Rodar e ver passar** com cobertura ≥ 80% em `core`. Comando: `pnpm vitest run packages/core --coverage`.
- [ ] **Step 5: Commit.** `feat(core): serviço de identidade e bootstrap do admin`

### Task 11: App worker

**Files:**
- Create: `apps/worker/{package.json,tsconfig.json,tsup.config.ts,vitest.config.ts}`, `apps/worker/src/main.ts`, `apps/worker/src/heartbeat.ts`, `apps/worker/src/handlers/system.ts`
- Test: `apps/worker/test/worker.test.ts`

**Interfaces:**
- Consumes: `createPgBossQueue`, `recordHeartbeat`, `QUEUES`, `createLogger`/`withContext` e `loadConfig(baseEnvSchema)`.
- Produces:
  - `startWorker(cfg: { databaseUrl: string; heartbeatMs?: number /* 30_000 */; logger?: Logger }): Promise<{ stop(): Promise<void> }>`. Registra os handlers e o heartbeat de nome `'worker'`. O `main.ts` chama `startWorker` e trata `SIGTERM`/`SIGINT` com `stop()` (que para o pg-boss com graceful shutdown).
  - O handler `system.echo` registra `{ jobId, data }` com `withContext`. Serve como job de exemplo.
  - Sentry é inicializado só se `SENTRY_DSN` estiver definido.

- [ ] **Step 1: Escrever os testes que falham**
  - Com `startWorker({ databaseUrl, heartbeatMs: 200 })`, `readHeartbeat(db, 'worker')` avança em 1 s.
  - `send(system.echo)` faz o log capturado conter `jobId` e `"msg":"echo"`.
  - Depois de `stop()`, o heartbeat para de avançar.
- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar e ver passar.** Rodar também `pnpm --filter @central/worker build`, que deve gerar `dist/main.js`.
- [ ] **Step 5: Commit.** `feat(worker): processo worker com heartbeat e job de exemplo`

### Task 12: API do web (sessão, auth, admin, health)

**Files:**
- Create:
  - `apps/web/{package.json,nuxt.config.ts,tsconfig.json,vitest.config.ts}`
  - `apps/web/server/utils/services.ts`, `apps/web/server/utils/auth.ts`
  - `apps/web/server/middleware/01.origin.ts`, `apps/web/server/middleware/02.session.ts`
  - `apps/web/server/api/health.get.ts`
  - `apps/web/server/api/auth/login.post.ts`, `logout.post.ts`, `totp/verify.post.ts`, `totp/enroll-start.post.ts`, `totp/enroll-confirm.post.ts`, `password.post.ts`
  - `apps/web/server/api/admin/users.get.ts`, `users.post.ts`, `users/[id].patch.ts`, `brands/[brandId]/members/[userId].put.ts`, `brands/[brandId]/members/[userId].delete.ts`
- Test: `apps/web/test/auth.test.ts`, `apps/web/test/admin.test.ts`, `apps/web/test/health.test.ts`, com `@nuxt/test-utils/e2e` e `globalSetup` que sobe Postgres e MinIO por Testcontainers e passa as URLs por env.

**Interfaces:**
- Consumes: `createIdentityService`, `loadActor`, `can`, `createPgBossQueue({ role: 'web' })`, `createStorage`, `readHeartbeat` e `createLogger`.
- Produces:
  - `useServices(): { db; identity; storage; queue; logger }`, um singleton lazy no Nitro.
  - Sessão nuxt-auth-utils: `user: { id, name, email, stage: LoginStage }` e `secure: { sessionVersion: number; pendingTotpSecret?: string; lastSeenAt: number }`.
  - `requireActor(event, opts?: { allowStages?: LoginStage[] /* padrão ['full'] */ }): Promise<Actor>`
  - `requirePermission(event, brandId: string | null, action: Action): Promise<Actor>`

**Comportamento:**
- **`01.origin`:** também define o `requestId` (`x-request-id` recebido ou uuid novo), devolve no cabeçalho de resposta e anexa `withContext(logger, { requestId, userId })` a `event.context.log`.
- **Bloqueio de origem:** em `POST/PUT/PATCH/DELETE`, se `Origin` não for igual a `APP_ORIGIN`, responde 403.
- **`02.session`** (rotas `/api/**`, exceto `/api/health` e `/api/auth/login`):
  - Carrega `loadActor`. Se for `null`, ou se `sessionVersion` diferir do banco, limpa a sessão e responde 401.
  - Se `lastSeenAt` tiver mais de 5 min, regrava a sessão. É isso que faz os 12 h deslizantes, com `maxAge` de 12 h na configuração.
- **Status por erro de domínio:**

  | Erro | HTTP |
  |---|---|
  | `InvalidCredentialsError` | 401 `{ message: 'E-mail ou senha inválidos' }` |
  | `TooManyAttemptsError` | 429 com `Retry-After` |
  | `InvalidTotpError` | 400 |
  | `ForbiddenError` | 403 |
  | `ConflictError` | 409 |
  | `LastAdminError` | 409 |
  | `ValidationError` ou zod | 422 |

- **Fluxo de login:**
  - `login.post` grava a sessão com o `stage` retornado.
  - `totp/verify.post` só é aceito em `totp_pending` e passa a sessão para `full`.
  - `enroll-start` é aceito em `totp_enroll` ou `full`, guarda `pendingTotpSecret` em `secure` e devolve `{ uri }`.
  - `enroll-confirm` passa para `full`.
  - `password.post` regrava a sessão com o novo `sessionVersion`, o que invalida as outras sessões.
- **`health.get`:**
  - Resposta: `{ status: 'ok'|'degraded', checks: { postgres: { ok, latencyMs }, storage: { ok }, worker: { ok, lastSeenAt } } }`.
  - O worker está ok se o heartbeat tiver ≤ 90 s.
  - HTTP 200 se tudo estiver ok, 503 caso contrário. Cada check tem timeout de 2 s. Nenhuma mensagem de erro interna é exposta.
- **Respostas de usuário** nunca incluem `passwordHash`, `totpSecretEnc` ou `totpLastUsedStep`.
- **Cabeçalhos de segurança** em todas as respostas: `Strict-Transport-Security` (produção), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` e `Content-Security-Policy` restritiva (`default-src 'self'`, ajustada ao que o Nuxt precisar).

- [ ] **Step 1: Escrever os testes que falham** (`$fetch`/`fetch` contra o servidor de teste)
  - Login e sessão:
    - Login de editor → 200 `{ stage: 'full' }`. Senha errada → 401 com a mensagem genérica.
    - Seis falhas → 429 com `Retry-After`.
    - Approver logado com `stage: 'totp_pending'` → `GET /api/admin/users` dá 401 ou 403. Depois de `totp/verify` com um código válido, segue a matriz normal.
  - Permissões (testes negativos):
    - Para **cada** rota em `/api/admin/**`, viewer, editor e approver recebem 403 e admin recebe 2xx.
    - Sem cookie → 401.
    - `POST` com `Origin: https://evil.example` → 403.
  - Usuário desativado: com a sessão ativa, o admin o desativa e a próxima requisição dele retorna 401.
  - Troca de senha: a sessão A troca a senha e a sessão B (outro cookie do mesmo usuário) passa a receber 401.
  - Health:
    - Tudo de pé com heartbeat recente → 200.
    - Sem heartbeat → 503 com `checks.worker.ok === false`.
    - Bucket inexistente → 503 com `checks.storage.ok === false`.
  - `GET /api/admin/users` não contém as chaves `passwordHash`, `totpSecretEnc` e `totpLastUsedStep`.
- [ ] **Step 2: Rodar e ver falhar.** Comando: `pnpm test:web`.
- [ ] **Step 3: Implementar** as rotas finas, que só validam com zod, chamam o serviço e mapeiam os erros.
- [ ] **Step 4: Rodar e ver passar.**
- [ ] **Step 5: Commit.** `feat(web): API de autenticação, administração de usuários e health`

### Task 13: Telas do painel e E2E

**Files:**
- Create:
  - `apps/web/app/app.vue`, `app/layouts/default.vue`
  - `app/pages/login.vue`, `app/pages/2fa.vue`, `app/pages/index.vue`, `app/pages/account.vue`, `app/pages/admin/users.vue`
  - `app/middleware/auth.global.ts`
  - `apps/web/playwright.config.ts`, `apps/web/e2e/auth.spec.ts`

**Interfaces:**
- Consumes: as rotas da Task 12 e `useUserSession()` do nuxt-auth-utils.
- Telas, todas em pt-BR com Nuxt UI:
  - `/login`
  - `/2fa`: verificação ou cadastro, este último com QR gerado no cliente a partir do `uri`, usando a lib `qrcode`.
  - `/`: início com o placeholder "Fase 1 — fundação pronta" e links por papel.
  - `/account`: troca de senha.
  - `/admin/users`: listar, criar com senha inicial, ativar/desativar e definir papel por marca.
- `auth.global.ts`:
  - sem sessão → `/login`;
  - `stage` diferente de `full` → `/2fa`;
  - `/admin/*` sem admin → `/`.

- [ ] **Step 1: Escrever o E2E que falha** (Playwright contra o servidor dev com o banco do `globalSetup`)
  1. O admin com TOTP faz login, gera o código com `otpauth` no teste e chega em `/`.
  2. Em `/admin/users`, cria `editor@x.com` com papel `editor` na marca.
  3. O editor faz login, cai em `/` sem passar por 2FA e, ao acessar `/admin/users`, é redirecionado para `/`.
  4. Um approver recém-criado faz login, cai em `/2fa` em modo cadastro e conclui com o código, chegando em `/`.
- [ ] **Step 2: Rodar e ver falhar.** Comando: `pnpm --filter @central/web exec playwright test`.
- [ ] **Step 3: Implementar as telas.**
- [ ] **Step 4: Rodar e ver passar.**
- [ ] **Step 5: Commit.** `feat(web): telas de login, 2FA, conta e usuários`

### Task 14: Docker Compose e imagens

**Files:**
- Create: `docker/web.Dockerfile`, `docker/worker.Dockerfile`, `compose.yaml` (dev), `compose.prod.yaml`, `Caddyfile`, `.env.example`, `.dockerignore`

**Decisões:**
- Imagens com build multi-stage em `node:24-slim` (`corepack enable`, `pnpm install --frozen-lockfile`, `prisma generate` e build), rodando como usuário `node` não root.
- O web executa `.output/server/index.mjs`. O worker executa `dist/main.js`. Nesta fase, FFmpeg **não** entra na imagem do worker (entra na Fase 3).
- **`compose.yaml` (dev):**
  - `postgres:17`, com volume e healthcheck `pg_isready`;
  - MinIO em tag fixa, com bucket criado por um serviço `minio-init` usando `mc`. Conferir se a imagem escolhida ainda é publicada; o código só depende da API S3;
  - `migrate` (one-shot com `prisma migrate deploy`);
  - `web` e `worker`, ambos com `depends_on: migrate: condition: service_completed_successfully`;
  - `caddy` em `localhost`.
- **`compose.prod.yaml`:**
  - sem MinIO (usa R2 por env);
  - imagens do registry (`ghcr.io/<owner>/central-web:<tag>`);
  - Postgres sem porta publicada;
  - Caddy com o domínio do painel (`{$PANEL_DOMAIN}`) e TLS automático;
  - `restart: unless-stopped`;
  - `read_only: true` + `tmpfs: /tmp` em web e worker.
- O `.env.example` lista todas as variáveis das Tasks 1, 12 e 14 (`APP_ORIGIN`, `NUXT_SESSION_PASSWORD` ≥ 32 caracteres, `TOTP_ISSUER=Central de Conteúdo`, `PANEL_DOMAIN`), com valores fictícios.

- [ ] **Step 1: Escrever um smoke test** (script `scripts/smoke.sh`, chamado pelo CI)
  - Roda `docker compose up -d --build --wait`.
  - Depois, `curl -fsS http://localhost/api/health` precisa devolver `"status":"ok"` em até 60 s.
  - Em seguida, `docker compose run --rm migrate` é idempotente (exit 0).
- [ ] **Step 2: Rodar e ver falhar** (ainda não há imagens).
- [ ] **Step 3: Escrever os Dockerfiles e os arquivos de compose.**
- [ ] **Step 4: Rodar `scripts/smoke.sh` e ver passar.** Rodar também `pnpm bootstrap:admin` dentro do container web (`docker compose exec web …`), que deve imprimir a senha uma única vez.
- [ ] **Step 5: Commit.** `build: imagens Docker, compose de dev/prod e Caddy`

### Task 15: CI, publicação de imagens e primeiro deploy

**Files:**
- Create: `.github/workflows/ci.yml`, `.github/workflows/images.yml`, `docs/runbooks/deploy.md`

**Decisões:**
- **`ci.yml`** (em push e PR):
  - checkout, `pnpm/action-setup`, Node 24 com cache do pnpm;
  - `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm typecheck`, `pnpm test` (Testcontainers usa o Docker do runner `ubuntu-latest`), `pnpm test:web`;
  - Playwright com `--with-deps`;
  - `scripts/smoke.sh`.
- **`images.yml`** (em push para `main` e em tags `v*`): build e push de `central-web` e `central-worker` para o GHCR, com tags `sha-<short>` e a tag da versão.
- **`deploy.md`**, o runbook da VPS (Hetzner CPX32, Ubuntu LTS):
  - usuário não root com chave SSH, `ufw` liberando só 22/80/443, `unattended-upgrades` e Docker;
  - `.env` em `/opt/central/.env` com `chmod 600`;
  - DNS do `PANEL_DOMAIN`;
  - deploy: `docker compose -f compose.prod.yaml pull`, depois `run --rm migrate`, depois `up -d`;
  - `bootstrap:admin`;
  - verificação de `/api/health`;
  - rollback trocando a tag e repetindo o deploy (as migrações são só aditivas nesta fase);
  - onde guardar `APP_ENCRYPTION_KEYS`: gerenciador de senhas, com 2 pessoas.

- [ ] **Step 1: Fazer o push para um repositório GitHub.** **Confirmar com o dono do produto** o nome, a visibilidade (privado) e a organização antes de criar. Esperado: o workflow `ci.yml` fica verde no primeiro push.
- [ ] **Step 2: Confirmar o `images.yml` verde** e as imagens visíveis no GHCR.
- [ ] **Step 3: Executar o runbook uma vez.** Depende de o dono do produto contratar a VPS e o domínio. **Confirmar antes**, porque gera custo. Esperado: `https://<PANEL_DOMAIN>/api/health` responde 200 com o certificado válido, e o admin faz login com 2FA em produção.
- [ ] **Step 4: Commit.** `ci: pipeline, imagens e runbook de deploy`

---

## Mapa critérios de aceite → tasks

| Critério da Fase 1 ([17](../../17-roadmap-e-criterios-de-aceite.md)) | Task |
|---|---|
| `docker compose up` sobe o ambiente local; `pnpm test` verde no CI | 14, 15 |
| Admin cria usuário, usuário faz login com 2FA, rotas negam acesso por papel | 10, 12, 13 |
| Job na mesma transação; rollback não cria job | 5 |
| Logs JSON com `requestId`/`jobId`; segredo não aparece | 2, 11 |
| `/api/health` com Postgres, storage e heartbeat do worker | 5, 6, 11, 12 |
| Deploy na VPS via imagens do CI, documentado e executado uma vez | 15 |
| Adaptador `fake` com interface `PlatformAdapter` definida | 7 |
