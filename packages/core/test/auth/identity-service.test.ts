import { randomBytes } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Secret, TOTP } from 'otpauth'
import { startTestDatabase } from '@central/db/testing'
import { createCipher } from '@central/shared'
import { createIdentityService, type IdentityService } from '../../src/auth/identity-service.js'
import { createLoginRateLimiter } from '../../src/auth/rate-limiter.js'
import { hashPassword } from '../../src/auth/password.js'
import type { Actor } from '../../src/authz/roles.js'
import {
  ConflictError,
  ForbiddenError,
  InvalidCredentialsError,
  InvalidTotpError,
  LastAdminError,
  TooManyAttemptsError,
  ValidationError,
} from '../../src/errors.js'

let db: Awaited<ReturnType<typeof startTestDatabase>> | undefined
const PASSWORD = 'senha-muito-segura-1'
const NOW = new Date('2026-11-15T12:00:00.000Z')
const cipher = createCipher(new Map([[1, randomBytes(32)]]))
const GHOST = '00000000-0000-7000-8000-000000000000'

let svc: IdentityService

function makeService(now: Date): IdentityService {
  return createIdentityService({
    db: db!.prisma,
    cipher,
    limiter: createLoginRateLimiter(),
    totpIssuer: 'Central',
    now: () => now,
  })
}

beforeAll(async () => {
  db = await startTestDatabase()
}, 120_000)
afterAll(() => db?.stop())

beforeEach(async () => {
  const p = db!.prisma
  await p.auditLog.deleteMany()
  await p.brandMember.deleteMany()
  await p.user.deleteMany()
  await p.brand.deleteMany()
  svc = makeService(NOW)
})

function codeAt(secret: string, at: Date): string {
  return new TOTP({ secret: Secret.fromBase32(secret), digits: 6, period: 30 }).generate({
    timestamp: at.getTime(),
  })
}

async function makeAdmin(email = 'admin@x.com'): Promise<Actor & { id: string }> {
  const u = await db!.prisma.user.create({
    data: { email, name: 'Admin', passwordHash: await hashPassword(PASSWORD), role: 'admin' },
  })
  return { id: u.id, userId: u.id, globalRole: 'admin', memberships: [] }
}

async function makeMember(
  email: string,
  role?: 'viewer' | 'editor' | 'approver' | 'admin',
): Promise<string> {
  const admin = await makeAdmin(`root-${email}`)
  const { id } = await svc.createUser(admin, { email, name: 'M', password: PASSWORD })
  if (role) {
    const brand = await db!.prisma.brand.create({ data: { name: email, slug: `b-${email}` } })
    await svc.setMembership(admin, brand.id, id, role)
  }
  return id
}

async function enrollTotp(userId: string): Promise<string> {
  const { secret } = await svc.startTotpEnrollment(userId)
  await svc.confirmTotpEnrollment(userId, secret, codeAt(secret, NOW))
  return secret
}

describe('login', () => {
  it('normaliza o e-mail em createUser e login; duplicata lança ConflictError', async () => {
    const admin = await makeAdmin()
    await svc.createUser(admin, { email: ' Ana@X.com ', name: 'Ana', password: PASSWORD })
    const r = await svc.login({ email: 'ana@x.com', password: PASSWORD, ip: '1.1.1.1' })
    expect(r.stage).toBe('full')
    await expect(
      svc.createUser(admin, { email: 'ANA@x.com', name: 'Ana', password: PASSWORD }),
    ).rejects.toBeInstanceOf(ConflictError)
  })

  it('stage: editor full; approver sem TOTP totp_enroll; com TOTP totp_pending', async () => {
    await makeMember('ed@x.com', 'editor')
    const ap = await makeMember('ap@x.com', 'approver')
    const input = (email: string) => ({ email, password: PASSWORD, ip: '1.1.1.1' })
    expect((await svc.login(input('ed@x.com'))).stage).toBe('full')
    expect((await svc.login(input('ap@x.com'))).stage).toBe('totp_enroll')
    await enrollTotp(ap)
    expect((await svc.login(input('ap@x.com'))).stage).toBe('totp_pending')
  })

  it('editor que ativou TOTP também cai em totp_pending', async () => {
    const ed = await makeMember('ed2@x.com', 'editor')
    await enrollTotp(ed)
    const r = await svc.login({ email: 'ed2@x.com', password: PASSWORD, ip: '1.1.1.1' })
    expect(r.stage).toBe('totp_pending')
  })

  it('seis senhas erradas: a sexta lança TooManyAttemptsError, mesmo com a senha certa', async () => {
    await makeMember('lim@x.com', 'editor')
    const bad = { email: 'lim@x.com', password: 'errada-errada-1', ip: '9.9.9.9' }
    for (let i = 0; i < 5; i++) {
      await expect(svc.login(bad)).rejects.toBeInstanceOf(InvalidCredentialsError)
    }
    await expect(svc.login({ ...bad, password: PASSWORD })).rejects.toBeInstanceOf(
      TooManyAttemptsError,
    )
  })

  it('não registra falhas enquanto bloqueado', async () => {
    await makeMember('blk@x.com', 'editor')
    const bad = { email: 'blk@x.com', password: 'errada-errada-1', ip: '9.9.9.8' }
    for (let i = 0; i < 5; i++) await svc.login(bad).catch(() => undefined)
    await svc.login(bad).catch(() => undefined)
    const failed = await db!.prisma.auditLog.count({ where: { action: 'auth.login_failed' } })
    expect(failed).toBe(5)
  })

  it('e-mail inexistente, senha errada e usuário desativado têm a mesma mensagem', async () => {
    const admin = await makeAdmin()
    await makeAdmin('admin2@x.com')
    const id = await makeMember('exist@x.com', 'editor')
    await svc.updateUser(admin, id, { status: 'disabled' })
    const msg = async (email: string, password: string) =>
      svc.login({ email, password, ip: '2.2.2.2' }).catch((e: Error) => e.message)
    const a = await msg('nao-existe@x.com', PASSWORD)
    const b = await msg('admin@x.com', 'errada-errada-1')
    const c = await msg('exist@x.com', PASSWORD)
    expect(typeof a).toBe('string')
    expect(a).toBe(b)
    expect(b).toBe(c)
  })

  it('sucesso zera o contador do e-mail e registra auth.login', async () => {
    await makeMember('ok@x.com', 'editor')
    const bad = { email: 'ok@x.com', password: 'errada-errada-1', ip: '3.3.3.3' }
    for (let i = 0; i < 4; i++) await svc.login(bad).catch(() => undefined)
    await svc.login({ ...bad, password: PASSWORD, ip: '3.3.3.5' })
    // contador do e-mail zerado: nova falha (outro IP) ainda não bloqueia
    await expect(svc.login({ ...bad, ip: '3.3.3.4' })).rejects.toBeInstanceOf(
      InvalidCredentialsError,
    )
    expect(await db!.prisma.auditLog.count({ where: { action: 'auth.login' } })).toBe(1)
  })
})

describe('TOTP', () => {
  it('confirmTotpEnrollment com código errado lança InvalidTotpError', async () => {
    const id = await makeMember('t1@x.com', 'approver')
    const { secret, uri } = await svc.startTotpEnrollment(id)
    expect(uri).toContain('otpauth://totp/')
    expect(uri).toContain('issuer=Central')
    await expect(svc.confirmTotpEnrollment(id, secret, '000000')).rejects.toBeInstanceOf(
      InvalidTotpError,
    )
  })

  it('código certo preenche totpEnabledAt e cifra o segredo com AAD user:<id>:totp', async () => {
    const id = await makeMember('t2@x.com', 'approver')
    const secret = await enrollTotp(id)
    const u = await db!.prisma.user.findUniqueOrThrow({ where: { id } })
    expect(u.totpEnabledAt).not.toBeNull()
    expect(u.totpSecretEnc).not.toBe(secret)
    expect(cipher.decrypt(u.totpSecretEnc!, `user:${id}:totp`)).toBe(secret)
    expect(u.totpLastUsedStep).toBe(BigInt(Math.floor(NOW.getTime() / 30000)))
    await expect(svc.startTotpEnrollment(id)).rejects.toBeInstanceOf(ConflictError)
  })

  it('o código de enrollment não pode ser reutilizado no login', async () => {
    const id = await makeMember('t3@x.com', 'approver')
    const secret = await enrollTotp(id)
    await expect(svc.verifyLoginTotp(id, codeAt(secret, NOW))).rejects.toBeInstanceOf(
      InvalidTotpError,
    )
  })

  it('replay: o mesmo código é recusado na segunda chamada', async () => {
    const id = await makeMember('t4@x.com', 'approver')
    const secret = await enrollTotp(id)
    const later = new Date(NOW.getTime() + 60_000)
    const s2 = makeService(later)
    const code = codeAt(secret, later)
    await s2.verifyLoginTotp(id, code)
    await expect(s2.verifyLoginTotp(id, code)).rejects.toBeInstanceOf(InvalidTotpError)
  })

  it('duas verificações concorrentes com o mesmo código: só uma passa', async () => {
    const id = await makeMember('t5@x.com', 'approver')
    const secret = await enrollTotp(id)
    const later = new Date(NOW.getTime() + 60_000)
    const s2 = makeService(later)
    const code = codeAt(secret, later)
    const results = await Promise.allSettled([
      s2.verifyLoginTotp(id, code),
      s2.verifyLoginTotp(id, code),
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult
    expect(rejected.reason).toBeInstanceOf(InvalidTotpError)
  })

  it('verifyLoginTotp sem TOTP ativado ou usuário inexistente lança InvalidTotpError', async () => {
    const id = await makeMember('t6@x.com', 'approver')
    await expect(svc.verifyLoginTotp(id, '123456')).rejects.toBeInstanceOf(InvalidTotpError)
    await expect(svc.verifyLoginTotp(GHOST, '123456')).rejects.toBeInstanceOf(InvalidTotpError)
  })
})

describe('senha e permissões', () => {
  it('changePassword incrementa sessionVersion e invalida a senha antiga', async () => {
    const id = await makeMember('cp@x.com', 'editor')
    const before = (await db!.prisma.user.findUniqueOrThrow({ where: { id } })).sessionVersion
    const r = await svc.changePassword(id, PASSWORD, 'nova-senha-bem-longa')
    expect(r.sessionVersion).toBe(before + 1)
    const login = (password: string) => svc.login({ email: 'cp@x.com', password, ip: '4.4.4.4' })
    await expect(login(PASSWORD)).rejects.toBeInstanceOf(InvalidCredentialsError)
    await expect(login('nova-senha-bem-longa')).resolves.toMatchObject({
      sessionVersion: before + 1,
    })
  })

  it('changePassword exige a senha atual e mínimo de 12 caracteres', async () => {
    const id = await makeMember('cp2@x.com', 'editor')
    await expect(
      svc.changePassword(id, 'errada-errada-1', 'nova-senha-bem-longa'),
    ).rejects.toBeInstanceOf(InvalidCredentialsError)
    await expect(svc.changePassword(id, PASSWORD, 'curta')).rejects.toBeInstanceOf(ValidationError)
    await expect(
      svc.changePassword(GHOST, PASSWORD, 'nova-senha-bem-longa'),
    ).rejects.toBeInstanceOf(InvalidCredentialsError)
  })

  it('createUser exige senha de 12+ caracteres', async () => {
    const admin = await makeAdmin()
    await expect(
      svc.createUser(admin, { email: 'c@x.com', name: 'C', password: 'curta' }),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it('último admin: com um único admin, desativar lança LastAdminError; com dois, permite', async () => {
    const admin = await makeAdmin()
    await expect(svc.updateUser(admin, admin.id, { status: 'disabled' })).rejects.toBeInstanceOf(
      LastAdminError,
    )
    await expect(svc.updateUser(admin, admin.id, { globalRole: 'member' })).rejects.toBeInstanceOf(
      LastAdminError,
    )
    await makeAdmin('admin2@x.com')
    await svc.updateUser(admin, admin.id, { status: 'disabled' })
    const u = await db!.prisma.user.findUniqueOrThrow({ where: { id: admin.id } })
    expect(u.status).toBe('disabled')
  })

  it('editor chamando createUser/updateUser/setMembership/listUsers lança ForbiddenError', async () => {
    const id = await makeMember('ed3@x.com', 'editor')
    const actor: Actor = { userId: id, globalRole: 'member', memberships: [] }
    await expect(
      svc.createUser(actor, { email: 'n@x.com', name: 'N', password: PASSWORD }),
    ).rejects.toBeInstanceOf(ForbiddenError)
    await expect(svc.updateUser(actor, id, { name: 'X' })).rejects.toBeInstanceOf(ForbiddenError)
    await expect(svc.setMembership(actor, id, id, null)).rejects.toBeInstanceOf(ForbiddenError)
    await expect(svc.listUsers(actor)).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('setMembership cria, altera e remove com auditoria; listUsers reflete', async () => {
    const admin = await makeAdmin()
    const { id } = await svc.createUser(admin, { email: 'm@x.com', name: 'M', password: PASSWORD })
    const brand = await db!.prisma.brand.create({ data: { name: 'B', slug: 'b-m' } })
    await svc.setMembership(admin, brand.id, id, 'viewer')
    await svc.setMembership(admin, brand.id, id, 'editor')
    let list = await svc.listUsers(admin)
    const m = list.find((u) => u.id === id)!
    expect(m.memberships).toEqual([{ brandId: brand.id, role: 'editor' }])
    expect(m.totpEnabled).toBe(false)
    await svc.setMembership(admin, brand.id, id, null)
    list = await svc.listUsers(admin)
    expect(list.find((u) => u.id === id)!.memberships).toEqual([])
    const actions = (await db!.prisma.auditLog.findMany()).map((a) => a.action)
    expect(actions.filter((a) => a === 'member.upserted')).toHaveLength(2)
    expect(actions).toContain('member.removed')
    await expect(svc.setMembership(admin, GHOST, id, 'viewer')).rejects.toBeInstanceOf(
      ValidationError,
    )
  })

  it('updateUser altera nome/papel e audita user.updated', async () => {
    const admin = await makeAdmin()
    const { id } = await svc.createUser(admin, { email: 'u@x.com', name: 'U', password: PASSWORD })
    await svc.updateUser(admin, id, { name: 'Novo', globalRole: 'admin' })
    const u = await db!.prisma.user.findUniqueOrThrow({ where: { id } })
    expect(u).toMatchObject({ name: 'Novo', role: 'admin' })
    expect(await db!.prisma.auditLog.count({ where: { action: 'user.updated' } })).toBe(1)
    await expect(svc.updateUser(admin, GHOST, { name: 'x' })).rejects.toBeInstanceOf(
      ValidationError,
    )
  })
})

describe('revogação de sessão ao mudar papel/status', () => {
  const version = async (id: string) =>
    (await db!.prisma.user.findUniqueOrThrow({ where: { id } })).sessionVersion

  it('updateUser incrementa sessionVersion ao mudar status ou globalRole, não ao mudar só o nome', async () => {
    const admin = await makeAdmin()
    const { id } = await svc.createUser(admin, { email: 'r@x.com', name: 'R', password: PASSWORD })
    const v0 = await version(id)
    await svc.updateUser(admin, id, { name: 'Outro' })
    expect(await version(id)).toBe(v0)
    await svc.updateUser(admin, id, { globalRole: 'admin' })
    expect(await version(id)).toBe(v0 + 1)
    await svc.updateUser(admin, id, { status: 'disabled' })
    expect(await version(id)).toBe(v0 + 2)
    await svc.updateUser(admin, id, { status: 'active' })
    expect(await version(id)).toBe(v0 + 3)
    // Valor igual ao atual não é mudança.
    await svc.updateUser(admin, id, { status: 'active', globalRole: 'admin' })
    expect(await version(id)).toBe(v0 + 3)
  })

  it('setMembership incrementa sessionVersion do alvo ao criar, alterar e remover vínculo', async () => {
    const admin = await makeAdmin()
    const { id } = await svc.createUser(admin, { email: 's@x.com', name: 'S', password: PASSWORD })
    const brand = await db!.prisma.brand.create({ data: { name: 'B', slug: 'b-s' } })
    const v0 = await version(id)
    await svc.setMembership(admin, brand.id, id, 'editor')
    expect(await version(id)).toBe(v0 + 1)
    await svc.setMembership(admin, brand.id, id, 'approver')
    expect(await version(id)).toBe(v0 + 2)
    await svc.setMembership(admin, brand.id, id, null)
    expect(await version(id)).toBe(v0 + 3)
    // Remover vínculo inexistente não muda nada.
    await svc.setMembership(admin, brand.id, id, null)
    expect(await version(id)).toBe(v0 + 3)
    expect(await version(admin.id)).toBe(1)
  })
})

describe('auditoria', () => {
  it('registra auth.login_failed e user.created, sem hash nem segredo no diff', async () => {
    const admin = await makeAdmin()
    const { id } = await svc.createUser(admin, { email: 'a@x.com', name: 'A', password: PASSWORD })
    await svc.login({ email: 'a@x.com', password: 'errada-errada-1', ip: '5.5.5.5' }).catch(() => 0)
    await svc.changePassword(id, PASSWORD, 'nova-senha-bem-longa')
    await svc.updateUser(admin, id, { name: 'B' })
    const logs = await db!.prisma.auditLog.findMany()
    const actions = logs.map((l) => l.action)
    expect(actions).toEqual(
      expect.arrayContaining(['auth.login_failed', 'user.created', 'auth.password_changed']),
    )
    const dump = JSON.stringify(logs.map((l) => l.diff))
    expect(dump).not.toMatch(/passwordHash|totpSecretEnc|argon2/i)
    expect(dump).not.toContain(PASSWORD)
  })

  it('auth.totp_enabled é auditado sem o segredo', async () => {
    const id = await makeMember('aud@x.com', 'approver')
    const secret = await enrollTotp(id)
    const log = await db!.prisma.auditLog.findFirstOrThrow({
      where: { action: 'auth.totp_enabled' },
    })
    expect(JSON.stringify(log.diff ?? null)).not.toContain(secret)
  })
})

describe('limite de TOTP e auditoria de login', () => {
  function makeLimitedService(clock: { t: number }): IdentityService {
    return createIdentityService({
      db: db!.prisma,
      cipher,
      limiter: createLoginRateLimiter({ now: () => clock.t }),
      totpIssuer: 'Central',
      now: () => new Date(clock.t),
    })
  }

  it('5 códigos errados bloqueiam; o 6º com código certo é recusado; depois da janela funciona', async () => {
    const clock = { t: NOW.getTime() }
    const s = makeLimitedService(clock)
    const admin = await makeAdmin()
    const { id } = await s.createUser(admin, { email: 'rl@x.com', name: 'R', password: PASSWORD })
    const { secret } = await s.startTotpEnrollment(id)
    await s.confirmTotpEnrollment(id, secret, codeAt(secret, new Date(clock.t)))
    clock.t += 60_000
    for (let i = 0; i < 5; i++) {
      await expect(s.verifyLoginTotp(id, '000000')).rejects.toBeInstanceOf(InvalidTotpError)
    }
    const good = codeAt(secret, new Date(clock.t))
    await expect(s.verifyLoginTotp(id, good)).rejects.toBeInstanceOf(TooManyAttemptsError)
    clock.t += 901_000
    await s.verifyLoginTotp(id, codeAt(secret, new Date(clock.t)))
  })

  it('confirmTotpEnrollment também é limitado', async () => {
    const id = await makeMember('rl2@x.com', 'approver')
    const { secret } = await svc.startTotpEnrollment(id)
    for (let i = 0; i < 5; i++) {
      await expect(svc.confirmTotpEnrollment(id, secret, '000000')).rejects.toBeInstanceOf(
        InvalidTotpError,
      )
    }
    await expect(svc.confirmTotpEnrollment(id, secret, codeAt(secret, NOW))).rejects.toBeInstanceOf(
      TooManyAttemptsError,
    )
  })

  it('confirmTotpEnrollment de usuário inexistente ou desativado lança ForbiddenError', async () => {
    await expect(
      svc.confirmTotpEnrollment(GHOST, 'JBSWY3DPEHPK3PXP', '123456'),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('login_failed não guarda o e-mail digitado de conta existente; mascara o desconhecido', async () => {
    await makeMember('real@x.com', 'editor')
    const ip = '6.6.6.6'
    await svc.login({ email: 'real@x.com', password: 'errada-errada-1', ip }).catch(() => 0)
    await svc.login({ email: 'Fulano@dominio.com', password: 'x', ip }).catch(() => 0)
    await svc.login({ email: 'sem-arroba', password: 'x', ip }).catch(() => 0)
    const logs = await db!.prisma.auditLog.findMany({ where: { action: 'auth.login_failed' } })
    const dumps = logs.map((l) => JSON.stringify(l.diff))
    expect(dumps.join('')).not.toContain('real@x.com')
    expect(dumps).toContain(JSON.stringify({ email: 'f***@dominio.com' }))
    expect(dumps).toContain(JSON.stringify({ email: '[invalid]' }))
    expect(logs.filter((l) => l.userId !== null)).toHaveLength(1)
  })

  it('auth.login e lastLoginAt só quando o login chega a full', async () => {
    const id = await makeMember('fl@x.com', 'approver')
    const count = () => db!.prisma.auditLog.count({ where: { action: 'auth.login', userId: id } })
    const last = async () =>
      (await db!.prisma.user.findUniqueOrThrow({ where: { id } })).lastLoginAt
    await svc.login({ email: 'fl@x.com', password: PASSWORD, ip: '7.7.7.7' })
    expect(await count()).toBe(0)
    expect(await last()).toBeNull()
    const secret = await enrollTotp(id)
    expect(await count()).toBe(1)
    expect(await last()).not.toBeNull()
    await svc.login({ email: 'fl@x.com', password: PASSWORD, ip: '7.7.7.7' })
    expect(await count()).toBe(1)
    const later = makeService(new Date(NOW.getTime() + 60_000))
    await later.verifyLoginTotp(id, codeAt(secret, new Date(NOW.getTime() + 60_000)))
    expect(await count()).toBe(2)
  })

  it('login com sucesso não zera a chave de IP; a chave de IP bloqueia entre e-mails', async () => {
    await makeMember('ip1@x.com', 'editor')
    const ip = '8.8.8.8'
    for (let i = 0; i < 3; i++) {
      await svc.login({ email: `x${i}@x.com`, password: 'errada-errada-1', ip }).catch(() => 0)
    }
    await svc.login({ email: 'ip1@x.com', password: PASSWORD, ip }) // sucesso, mesmo IP
    for (let i = 3; i < 5; i++) {
      await svc.login({ email: `x${i}@x.com`, password: 'errada-errada-1', ip }).catch(() => 0)
    }
    // 5 falhas acumuladas no IP apesar do sucesso: bloqueado, mesmo com e-mail novo e senha certa
    await expect(svc.login({ email: 'ip1@x.com', password: PASSWORD, ip })).rejects.toBeInstanceOf(
      TooManyAttemptsError,
    )
  })

  it('updateUser sem campos lança ValidationError', async () => {
    const admin = await makeAdmin()
    await expect(svc.updateUser(admin, admin.id, {})).rejects.toBeInstanceOf(ValidationError)
  })
})
