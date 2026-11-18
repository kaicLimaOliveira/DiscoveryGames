import { randomBytes } from 'node:crypto'
import type { Db } from '@central/db'
import { ValidationError } from '../errors.js'

const INVALID = 'Autorização expirada ou inválida. Tente conectar de novo.'

export async function createOAuthState(
  db: Db,
  input: { provider: string; organizationId: string; userId: string; ttlMs?: number },
): Promise<{ state: string; codeVerifier: string }> {
  const state = randomBytes(32).toString('base64url')
  const codeVerifier = randomBytes(32).toString('base64url')
  const now = Date.now()
  // Limpeza oportunista dos expirados; evita crescer sem job dedicado.
  await db.oAuthState.deleteMany({ where: { expiresAt: { lt: new Date(now) } } })
  await db.oAuthState.create({
    data: {
      id: state,
      provider: input.provider,
      organizationId: input.organizationId,
      userId: input.userId,
      codeVerifier,
      expiresAt: new Date(now + (input.ttlMs ?? 10 * 60_000)),
    },
  })
  return { state, codeVerifier }
}

interface StateRow {
  provider: string
  organizationId: string
  userId: string
  codeVerifier: string
  expiresAt: Date
}

/** Uso único: `DELETE … RETURNING` atômico. Qualquer falha de validação também consome. */
export async function consumeOAuthState(
  db: Db,
  input: { state: string; provider: string; userId: string },
): Promise<{ organizationId: string; codeVerifier: string }> {
  const rows = await db.$queryRaw<StateRow[]>`
    DELETE FROM "OAuthState" WHERE "id" = ${input.state}
    RETURNING "provider", "organizationId", "userId", "codeVerifier", "expiresAt"`
  const row = rows[0]
  if (
    !row ||
    row.provider !== input.provider ||
    row.userId !== input.userId ||
    row.expiresAt.getTime() <= Date.now()
  ) {
    throw new ValidationError(INVALID)
  }
  return { organizationId: row.organizationId, codeVerifier: row.codeVerifier }
}
