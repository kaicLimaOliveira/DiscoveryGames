import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startTestDatabase } from '@central/db/testing'
import { ValidationError } from '../../src/errors.js'
import { consumeOAuthState, createOAuthState } from '../../src/accounts/oauth-state.js'

let db: Awaited<ReturnType<typeof startTestDatabase>> | undefined
const ORG = '00000000-0000-7000-8000-000000000001'
const USER = '00000000-0000-7000-8000-000000000002'
const OTHER = '00000000-0000-7000-8000-000000000003'

beforeAll(async () => {
  db = await startTestDatabase()
}, 120_000)
afterAll(() => db?.stop())

const input = { provider: 'youtube', organizationId: ORG, userId: USER }

describe('oauth state', () => {
  it('consome uma única vez', async () => {
    const { state, codeVerifier } = await createOAuthState(db!.prisma, input)
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(codeVerifier.length).toBeGreaterThanOrEqual(43)
    const got = await consumeOAuthState(db!.prisma, { state, provider: 'youtube', userId: USER })
    expect(got).toEqual({ organizationId: ORG, codeVerifier })
    await expect(
      consumeOAuthState(db!.prisma, { state, provider: 'youtube', userId: USER }),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it('expirado lança e é apagado', async () => {
    const { state } = await createOAuthState(db!.prisma, { ...input, ttlMs: -1000 })
    await expect(
      consumeOAuthState(db!.prisma, { state, provider: 'youtube', userId: USER }),
    ).rejects.toThrow('Autorização expirada ou inválida. Tente conectar de novo.')
    expect(await db!.prisma.oAuthState.count({ where: { id: state } })).toBe(0)
  })

  it('de outro usuário lança e é apagado', async () => {
    const { state } = await createOAuthState(db!.prisma, input)
    await expect(
      consumeOAuthState(db!.prisma, { state, provider: 'youtube', userId: OTHER }),
    ).rejects.toBeInstanceOf(ValidationError)
    expect(await db!.prisma.oAuthState.count({ where: { id: state } })).toBe(0)
  })

  it('state inexistente ou de outro provedor lança', async () => {
    await expect(
      consumeOAuthState(db!.prisma, { state: 'nada', provider: 'youtube', userId: USER }),
    ).rejects.toBeInstanceOf(ValidationError)
    const { state } = await createOAuthState(db!.prisma, input)
    await expect(
      consumeOAuthState(db!.prisma, { state, provider: 'outro', userId: USER }),
    ).rejects.toBeInstanceOf(ValidationError)
  })
})
