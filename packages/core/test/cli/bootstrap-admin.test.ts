import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'
import { startTestDatabase } from '@central/db/testing'
import { bootstrapAdmin } from '../../src/auth/identity-service.js'
import { verifyPassword } from '../../src/auth/password.js'
import { ConflictError } from '../../src/errors.js'
import { runBootstrapCli } from '../../src/cli/bootstrap-admin.js'

let db: Awaited<ReturnType<typeof startTestDatabase>> | undefined
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
})

const input = { email: ' Root@X.com ', name: 'Root', brandName: 'Marca', brandSlug: 'marca' }

it('cria a marca e o admin; a segunda execução lança ConflictError', async () => {
  const { password } = await bootstrapAdmin(db!.prisma, input)
  expect(password).toHaveLength(20)
  const user = await db!.prisma.user.findUniqueOrThrow({
    where: { email: 'root@x.com' },
    include: { memberships: true },
  })
  expect(user.role).toBe('admin')
  expect(await verifyPassword(user.passwordHash, password)).toBe(true)
  expect(user.memberships).toHaveLength(1)
  expect(user.memberships[0]!.role).toBe('admin')
  expect(await db!.prisma.brand.count()).toBe(1)
  await expect(bootstrapAdmin(db!.prisma, input)).rejects.toBeInstanceOf(ConflictError)
  expect(await db!.prisma.brand.count()).toBe(1)
})

it('bootstraps concorrentes: só um vence', async () => {
  const r = await Promise.allSettled([
    bootstrapAdmin(db!.prisma, input),
    bootstrapAdmin(db!.prisma, { ...input, email: 'o@x.com', brandSlug: 'outra' }),
  ])
  expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1)
  expect(await db!.prisma.user.count({ where: { role: 'admin' } })).toBe(1)
})

function capture() {
  const out: string[] = []
  const err: string[] = []
  return {
    out,
    err,
    deps: { db: db!.prisma, out: (s: string) => out.push(s), err: (s: string) => err.push(s) },
  }
}

const args = [
  '--email',
  'cli@x.com',
  '--name',
  'Cli',
  '--brand-name',
  'Marca',
  '--brand-slug',
  'cli',
]

it('CLI imprime a senha uma vez e retorna 0; tolera "--" inicial', async () => {
  const c = capture()
  expect(await runBootstrapCli(['--', ...args], c.deps)).toBe(0)
  const printed = c.out.join('\n')
  const password = /Senha: (\S{20})/.exec(printed)?.[1]
  expect(password).toBeDefined()
  expect(printed.split(password!)).toHaveLength(2)
  const user = await db!.prisma.user.findUniqueOrThrow({ where: { email: 'cli@x.com' } })
  expect(await verifyPassword(user.passwordHash, password!)).toBe(true)
})

it('CLI retorna 1 com mensagem clara em ConflictError', async () => {
  await bootstrapAdmin(db!.prisma, input)
  const c = capture()
  expect(await runBootstrapCli(args, c.deps)).toBe(1)
  expect(c.err.join('\n')).toMatch(/administrador/i)
  expect(c.out).toHaveLength(0)
})

it('CLI com argumentos faltando retorna 2 e mostra o uso', async () => {
  const c = capture()
  expect(await runBootstrapCli(['--email', 'x@x.com'], c.deps)).toBe(2)
  expect(c.err.join('\n')).toMatch(/--brand-slug/)
  expect(await runBootstrapCli(['--bogus'], capture().deps)).toBe(2)
})
