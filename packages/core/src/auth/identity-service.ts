import type { BrandRole, Db, DbOrTx, GlobalRole, Tx, UserStatus } from '@central/db'
import type { SecretCipher } from '@central/shared'
import { writeAudit } from '../audit.js'
import { can, requires2fa, type Actor } from '../authz/roles.js'
import {
  ConflictError,
  ForbiddenError,
  InvalidCredentialsError,
  InvalidTotpError,
  LastAdminError,
  TooManyAttemptsError,
  ValidationError,
} from '../errors.js'
import { hashPassword, verifyPassword } from './password.js'
import type { LoginRateLimiter } from './rate-limiter.js'
import { generateTotpSecret, totpUri, verifyTotp } from './totp.js'

export type LoginStage = 'full' | 'totp_pending' | 'totp_enroll'

export interface IdentityService {
  login(i: {
    email: string
    password: string
    ip: string
  }): Promise<{ userId: string; stage: LoginStage; sessionVersion: number }>
  verifyLoginTotp(userId: string, code: string): Promise<void>
  startTotpEnrollment(userId: string): Promise<{ secret: string; uri: string }>
  confirmTotpEnrollment(userId: string, secret: string, code: string): Promise<void>
  changePassword(userId: string, current: string, next: string): Promise<{ sessionVersion: number }>
  createUser(
    actor: Actor,
    i: { email: string; name: string; password: string; globalRole?: GlobalRole },
  ): Promise<{ id: string }>
  updateUser(
    actor: Actor,
    userId: string,
    i: { status?: UserStatus; globalRole?: GlobalRole; name?: string },
  ): Promise<void>
  setMembership(
    actor: Actor,
    brandId: string,
    userId: string,
    role: BrandRole | null,
  ): Promise<void>
  listUsers(actor: Actor): Promise<
    Array<{
      id: string
      email: string
      name: string
      role: GlobalRole
      status: UserStatus
      totpEnabled: boolean
      memberships: Array<{ brandId: string; role: BrandRole }>
    }>
  >
}

const MIN_PASSWORD = 12

export const normalizeEmail = (email: string): string => email.trim().toLowerCase()

function assertPassword(password: string): void {
  if (password.length < MIN_PASSWORD) {
    throw new ValidationError(`A senha deve ter pelo menos ${MIN_PASSWORD} caracteres.`)
  }
}

export function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'P2002'
}

// Hash descartável (calculado uma vez) para igualar o tempo de resposta quando o
// e-mail não existe, sem revelar a existência da conta.
function maskEmail(email: string): string {
  const at = email.lastIndexOf('@')
  if (at < 1 || at === email.length - 1) return '[invalid]'
  return `${email[0]}***@${email.slice(at + 1)}`
}

/** Vínculos mudam o 2FA exigido: força novo login, que recalcula o estágio. */
async function revokeSessions(tx: Tx, userId: string): Promise<void> {
  await tx.user.update({ where: { id: userId }, data: { sessionVersion: { increment: 1 } } })
}

/** Trava os admins ativos até o fim da transação (evita corrida no "último admin"). */
async function lockActiveAdmins(tx: Tx): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "User" WHERE role = 'admin' AND status = 'active' FOR UPDATE`
}

export function createIdentityService(deps: {
  db: Db
  cipher: SecretCipher
  limiter: LoginRateLimiter
  totpIssuer: string
  now?: () => Date
}): IdentityService {
  const { db, cipher, limiter, totpIssuer } = deps
  const now = deps.now ?? (() => new Date())
  // Calculado uma vez, já na criação do serviço.
  const dummyHash = hashPassword('dummy-password-timing')
  dummyHash.catch(() => undefined)
  const getDummyHash = (): Promise<string> => dummyHash
  const totpAad = (id: string) => `user:${id}:totp`

  async function recordLogin(client: DbOrTx, userId: string, ip?: string): Promise<void> {
    const run = async (tx: DbOrTx) => {
      await tx.user.update({ where: { id: userId }, data: { lastLoginAt: now() } })
      await writeAudit(tx, {
        action: 'auth.login',
        entityType: 'user',
        entityId: userId,
        userId,
        ip,
      })
    }
    if ('$transaction' in client) await client.$transaction((tx) => run(tx))
    else await run(client)
  }

  function requireManage(actor: Actor): void {
    if (!can(actor, null, 'users.manage')) throw new ForbiddenError()
  }

  return {
    async login({ email: rawEmail, password, ip }) {
      const email = normalizeEmail(rawEmail)
      const keys = [`ip:${ip}`, `email:${email}`]
      const wait = limiter.retryAfterMs(keys)
      if (wait > 0) throw new TooManyAttemptsError(wait)

      const user = await db.user.findUnique({
        where: { email },
        include: { memberships: { select: { brandId: true, role: true } } },
      })
      const ok = await verifyPassword(user?.passwordHash ?? (await getDummyHash()), password)
      if (!user || !ok || user.status === 'disabled') {
        limiter.recordFailure(keys)
        await writeAudit(db, {
          action: 'auth.login_failed',
          entityType: 'user',
          entityId: user?.id,
          userId: user?.id,
          // Privacidade: conta existente é identificada por userId; e-mail desconhecido só mascarado.
          diff: user ? undefined : { email: maskEmail(email) },
          ip,
        })
        throw new InvalidCredentialsError()
      }
      limiter.reset(`email:${email}`)
      const needs2fa = requires2fa({
        userId: user.id,
        globalRole: user.role,
        memberships: user.memberships,
      })
      let stage: LoginStage = 'full'
      if (user.totpEnabledAt) stage = 'totp_pending'
      else if (needs2fa) stage = 'totp_enroll'
      if (stage === 'full') await recordLogin(db, user.id, ip)
      return { userId: user.id, stage, sessionVersion: user.sessionVersion }
    },

    async verifyLoginTotp(userId, code) {
      const keys = [`totp:${userId}`]
      const wait = limiter.retryAfterMs(keys)
      if (wait > 0) throw new TooManyAttemptsError(wait)
      try {
        const user = await db.user.findUnique({ where: { id: userId } })
        if (!user || user.status === 'disabled' || !user.totpEnabledAt || !user.totpSecretEnc) {
          throw new InvalidTotpError()
        }
        const secret = cipher.decrypt(user.totpSecretEnc, totpAad(userId))
        const result = verifyTotp(secret, code, user.totpLastUsedStep, now())
        if (!result.ok) throw new InvalidTotpError()
        await db.$transaction(async (tx) => {
          // Atômico: só avança se nenhum outro request consumiu este step ou um posterior.
          const { count } = await tx.user.updateMany({
            where: {
              id: userId,
              OR: [{ totpLastUsedStep: null }, { totpLastUsedStep: { lt: result.step } }],
            },
            data: { totpLastUsedStep: result.step },
          })
          if (count !== 1) throw new InvalidTotpError()
          await recordLogin(tx, userId)
        })
      } catch (err) {
        if (err instanceof InvalidTotpError) limiter.recordFailure(keys)
        throw err
      }
      limiter.reset(keys[0]!)
    },

    async startTotpEnrollment(userId) {
      const user = await db.user.findUnique({ where: { id: userId } })
      if (!user || user.status === 'disabled') throw new ForbiddenError()
      if (user.totpEnabledAt) throw new ConflictError('O 2FA já está ativado.')
      const secret = generateTotpSecret()
      return { secret, uri: totpUri(secret, user.email, totpIssuer) }
    },

    async confirmTotpEnrollment(userId, secret, code) {
      const keys = [`totp:${userId}`]
      const wait = limiter.retryAfterMs(keys)
      if (wait > 0) throw new TooManyAttemptsError(wait)
      const user = await db.user.findUnique({ where: { id: userId } })
      if (!user || user.status === 'disabled') throw new ForbiddenError()
      const result = verifyTotp(secret, code, null, now())
      if (!result.ok) {
        limiter.recordFailure(keys)
        throw new InvalidTotpError()
      }
      await db.$transaction(async (tx) => {
        const { count } = await tx.user.updateMany({
          where: { id: userId, totpEnabledAt: null },
          data: {
            totpSecretEnc: cipher.encrypt(secret, totpAad(userId)),
            totpEnabledAt: now(),
            // O código de enrollment não pode ser reaproveitado no login.
            totpLastUsedStep: result.step,
          },
        })
        if (count !== 1) throw new ConflictError('O 2FA já está ativado.')
        await writeAudit(tx, {
          action: 'auth.totp_enabled',
          entityType: 'user',
          entityId: userId,
          userId,
        })
        await recordLogin(tx, userId)
      })
      limiter.reset(keys[0]!)
    },

    async changePassword(userId, current, next) {
      assertPassword(next)
      const user = await db.user.findUnique({ where: { id: userId } })
      const ok = await verifyPassword(user?.passwordHash ?? (await getDummyHash()), current)
      if (!user || user.status === 'disabled' || !ok) throw new InvalidCredentialsError()
      const passwordHash = await hashPassword(next)
      return db.$transaction(async (tx) => {
        const updated = await tx.user.update({
          where: { id: userId },
          data: { passwordHash, sessionVersion: { increment: 1 } },
        })
        await writeAudit(tx, {
          action: 'auth.password_changed',
          entityType: 'user',
          entityId: userId,
          userId,
        })
        return { sessionVersion: updated.sessionVersion }
      })
    },

    async createUser(actor, i) {
      requireManage(actor)
      assertPassword(i.password)
      const email = normalizeEmail(i.email)
      if (!email.includes('@')) throw new ValidationError('E-mail inválido.')
      const passwordHash = await hashPassword(i.password)
      const role = i.globalRole ?? 'member'
      try {
        return await db.$transaction(async (tx) => {
          const user = await tx.user.create({
            data: { email, name: i.name.trim(), passwordHash, role },
          })
          await writeAudit(tx, {
            action: 'user.created',
            entityType: 'user',
            entityId: user.id,
            userId: actor.userId,
            diff: { email, name: user.name, role },
          })
          return { id: user.id }
        })
      } catch (err) {
        if (isUniqueViolation(err)) throw new ConflictError('Já existe um usuário com este e-mail.')
        throw err
      }
    },

    async updateUser(actor, userId, i) {
      requireManage(actor)
      if (i.status === undefined && i.globalRole === undefined && i.name === undefined) {
        throw new ValidationError('Nenhuma alteração informada.')
      }
      await db.$transaction(async (tx) => {
        await lockActiveAdmins(tx)
        const target = await tx.user.findUnique({ where: { id: userId } })
        if (!target) throw new ValidationError('Usuário não encontrado.')
        const status = i.status ?? target.status
        const role = i.globalRole ?? target.role
        const wasActiveAdmin = target.role === 'admin' && target.status === 'active'
        if (wasActiveAdmin && !(role === 'admin' && status === 'active')) {
          const others = await tx.user.count({
            where: { role: 'admin', status: 'active', id: { not: userId } },
          })
          if (others === 0) throw new LastAdminError()
        }
        const data: { status?: UserStatus; role?: GlobalRole; name?: string } = {}
        if (i.status !== undefined) data.status = i.status
        if (i.globalRole !== undefined) data.role = i.globalRole
        if (i.name !== undefined) data.name = i.name.trim()
        // Mudar status ou papel global revoga as sessões abertas: o novo login recalcula o
        // estágio (2FA obrigatório) e um usuário reativado não reaproveita cookies antigos.
        const revoke = status !== target.status || role !== target.role
        await tx.user.update({
          where: { id: userId },
          data: revoke ? { ...data, sessionVersion: { increment: 1 } } : data,
        })
        await writeAudit(tx, {
          action: 'user.updated',
          entityType: 'user',
          entityId: userId,
          userId: actor.userId,
          diff: data,
        })
      })
    },

    async setMembership(actor, brandId, userId, role) {
      requireManage(actor)
      await db.$transaction(async (tx) => {
        const [user, brand] = await Promise.all([
          tx.user.findUnique({ where: { id: userId }, select: { id: true } }),
          tx.brand.findUnique({ where: { id: brandId }, select: { id: true } }),
        ])
        if (!user || !brand) throw new ValidationError('Usuário ou marca não encontrado.')
        if (role === null) {
          const { count } = await tx.brandMember.deleteMany({ where: { brandId, userId } })
          if (count === 0) return
          await revokeSessions(tx, userId)
          await writeAudit(tx, {
            action: 'member.removed',
            entityType: 'brand_member',
            entityId: userId,
            userId: actor.userId,
            brandId,
          })
          return
        }
        await tx.brandMember.upsert({
          where: { brandId_userId: { brandId, userId } },
          create: { brandId, userId, role },
          update: { role },
        })
        await revokeSessions(tx, userId)
        await writeAudit(tx, {
          action: 'member.upserted',
          entityType: 'brand_member',
          entityId: userId,
          userId: actor.userId,
          brandId,
          diff: { role },
        })
      })
    },

    async listUsers(actor) {
      requireManage(actor)
      const users = await db.user.findMany({
        orderBy: { email: 'asc' },
        include: { memberships: { select: { brandId: true, role: true } } },
      })
      return users.map((u) => ({
        id: u.id,
        email: u.email,
        name: u.name,
        role: u.role,
        status: u.status,
        totpEnabled: u.totpEnabledAt !== null,
        memberships: u.memberships,
      }))
    },
  }
}
