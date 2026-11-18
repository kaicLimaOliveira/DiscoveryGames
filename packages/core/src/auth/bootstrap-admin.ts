import { randomInt } from 'node:crypto'
import type { Db } from '@central/db'
import { writeAudit } from '../audit.js'
import { ConflictError } from '../errors.js'
import { hashPassword } from './password.js'
import { isUniqueViolation } from '../db-errors.js'
import { normalizeEmail } from './identity-service.js'

const PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'

function generatePassword(length = 20): string {
  let out = ''
  for (let i = 0; i < length; i++) out += PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)]
  return out
}

/** Cria a primeira organização e o admin global. Lança ConflictError se já houver admin. */
export async function bootstrapAdmin(
  db: Db,
  i: { email: string; name: string; orgName: string; orgSlug: string },
): Promise<{ password: string }> {
  const password = generatePassword()
  const passwordHash = await hashPassword(password)
  const email = normalizeEmail(i.email)
  try {
    await db.$transaction(async (tx) => {
      // Serializa bootstraps concorrentes.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('bootstrap-admin'))`
      if ((await tx.user.count({ where: { role: 'admin' } })) > 0) {
        throw new ConflictError('Já existe um administrador global.')
      }
      const organization = await tx.organization.create({
        data: { name: i.orgName, slug: i.orgSlug },
      })
      const user = await tx.user.create({
        data: {
          email,
          name: i.name.trim(),
          passwordHash,
          role: 'admin',
          memberships: { create: { organizationId: organization.id, role: 'admin' } },
        },
      })
      await writeAudit(tx, {
        action: 'user.created',
        entityType: 'user',
        entityId: user.id,
        organizationId: organization.id,
        diff: { email, name: user.name, role: 'admin', bootstrap: true },
      })
    })
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new ConflictError('Já existe usuário ou organização com este e-mail ou slug.')
    }
    throw err
  }
  return { password }
}
