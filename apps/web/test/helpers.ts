import { randomUUID } from 'node:crypto'
import { generateTotpSecret, hashPassword } from '@central/core'
import { createPrisma, type OrganizationRole, type GlobalRole } from '@central/db'
import { createCipher, cryptoEnvSchema, loadConfig } from '@central/shared'
import { fetch, setup } from '@nuxt/test-utils/e2e'
import { Secret, TOTP } from 'otpauth'
import { inject } from 'vitest'
import { OUTPUT_DIR, ROOT_DIR, TEST_ORIGIN } from './constants'

export const env = inject('webEnv')

/** Sobe o servidor Nitro já construído no globalSetup (um processo por arquivo de teste). */
export async function setupServer(): Promise<void> {
  await setup({
    rootDir: ROOT_DIR,
    build: false,
    server: true,
    nuxtConfig: { nitro: { output: { dir: OUTPUT_DIR } } },
    env,
  })
}

export const db = createPrisma(env.DATABASE_URL!)
const cipher = createCipher(loadConfig(cryptoEnvSchema, env).APP_ENCRYPTION_KEYS)

export const PASSWORD = 'senha-de-teste-forte-123'

export function uniqueEmail(prefix: string): string {
  return `${prefix}-${randomUUID().slice(0, 8)}@teste.dev`
}

/** IP falso por teste (o servidor de teste confia em X-Forwarded-For). */
export function uniqueIp(): string {
  const b = () => Math.floor(Math.random() * 250) + 1
  return `10.${b()}.${b()}.${b()}`
}

export async function createOrganization(): Promise<{ id: string }> {
  const slug = `org-${randomUUID().slice(0, 8)}`
  return db.organization.create({ data: { name: slug, slug }, select: { id: true } })
}

export interface TestUser {
  id: string
  email: string
  password: string
  totpSecret?: string
}

export async function createUser(opts: {
  prefix: string
  role?: GlobalRole
  memberships?: Array<{ organizationId: string; role: OrganizationRole }>
  totp?: boolean
}): Promise<TestUser> {
  const email = uniqueEmail(opts.prefix)
  const user = await db.user.create({
    data: {
      email,
      name: opts.prefix,
      passwordHash: await hashPassword(PASSWORD),
      role: opts.role ?? 'member',
      memberships: opts.memberships ? { create: opts.memberships } : undefined,
    },
  })
  let totpSecret: string | undefined
  if (opts.totp) {
    totpSecret = generateTotpSecret()
    await db.user.update({
      where: { id: user.id },
      data: {
        totpSecretEnc: cipher.encrypt(totpSecret, `user:${user.id}:totp`),
        totpEnabledAt: new Date(),
      },
    })
  }
  return { id: user.id, email, password: PASSWORD, totpSecret }
}

/** Código TOTP para o menor step aceito (janela ±1) acima do último usado. */
export async function nextTotpCode(userId: string, secret: string): Promise<string> {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } })
  const last = user.totpLastUsedStep
  const nowStep = BigInt(Math.floor(Date.now() / 30_000))
  for (const step of [nowStep - 1n, nowStep, nowStep + 1n]) {
    if (last === null || step > last) return totpCodeAt(secret, step)
  }
  throw new Error('Nenhum step TOTP disponível; aguarde o próximo período')
}

export function totpCodeAt(secret: string, step: bigint): string {
  const totp = new TOTP({
    secret: Secret.fromBase32(secret),
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
  })
  return totp.generate({ timestamp: Number(step) * 30_000 })
}

export interface ApiResponse {
  status: number
  headers: Headers
  body: unknown
}

export interface RequestOptions {
  method?: string
  body?: unknown
  origin?: string | null
  ip?: string
  headers?: Record<string, string>
}

const SESSION_COOKIE = 'central-session'

/** Cliente HTTP com seu próprio cookie de sessão (um "navegador"). */
export class Client {
  cookie: string | undefined
  /** Último Set-Cookie bruto da sessão (com atributos como Expires). */
  lastSetCookie: string | undefined

  async request(path: string, opts: RequestOptions = {}): Promise<ApiResponse> {
    const method = opts.method ?? 'GET'
    const headers: Record<string, string> = { accept: 'application/json', ...opts.headers }
    const origin = opts.origin === undefined ? TEST_ORIGIN : opts.origin
    if (origin !== null && method !== 'GET') headers.origin = origin
    if (this.cookie) headers.cookie = `${SESSION_COOKIE}=${this.cookie}`
    if (opts.ip) headers['x-forwarded-for'] = opts.ip
    if (opts.body !== undefined) headers['content-type'] = 'application/json'
    const res = await fetch(path, {
      method,
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      redirect: 'manual',
    })
    for (const raw of res.headers.getSetCookie()) {
      const [pair] = raw.split(';')
      const eq = pair!.indexOf('=')
      if (pair!.slice(0, eq) !== SESSION_COOKIE) continue
      const value = pair!.slice(eq + 1)
      this.lastSetCookie = raw
      this.cookie = value === '' ? undefined : value
    }
    const text = await res.text()
    let body: unknown = null
    if (text) {
      try {
        body = JSON.parse(text)
      } catch {
        body = text
      }
    }
    return { status: res.status, headers: res.headers, body }
  }

  login(email: string, password: string, ip = uniqueIp()): Promise<ApiResponse> {
    return this.request('/api/auth/login', { method: 'POST', body: { email, password }, ip })
  }

  /** Data de expiração do último Set-Cookie da sessão. */
  cookieExpires(): number {
    const match = /expires=([^;]+)/i.exec(this.lastSetCookie ?? '')
    return match ? Date.parse(match[1]!) : NaN
  }

  /** Login completo: senha e, se o usuário tiver TOTP, o segundo fator. */
  async loginFull(user: TestUser): Promise<void> {
    const res = await this.login(user.email, user.password)
    if (res.status !== 200) throw new Error(`login falhou: ${res.status}`)
    const stage = (res.body as { stage: string }).stage
    if (stage === 'full') return
    if (stage !== 'totp_pending' || !user.totpSecret) throw new Error(`stage inesperado: ${stage}`)
    const code = await nextTotpCode(user.id, user.totpSecret)
    const v = await this.request('/api/auth/totp/verify', { method: 'POST', body: { code } })
    if (v.status !== 200) throw new Error(`verificação TOTP falhou: ${v.status}`)
  }
}

export async function loggedIn(user: TestUser): Promise<Client> {
  const client = new Client()
  await client.loginFull(user)
  return client
}
