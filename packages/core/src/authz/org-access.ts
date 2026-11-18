import type { DbOrTx } from '@central/db'
import { ForbiddenError, NotFoundError } from '../errors.js'
import { can, type Action, type Actor } from './roles.js'

const ORG_NOT_FOUND = 'Organização não encontrada.'

/**
 * Exige que o ator enxergue a organização e possa executar a ação. Quem não pertence à
 * organização recebe NotFoundError (não revela a existência); quem pertence sem permissão,
 * ForbiddenError.
 */
export async function requireOrgAccess(
  db: DbOrTx,
  actor: Actor,
  orgId: string,
  action: Action,
): Promise<void> {
  const visible =
    actor.globalRole === 'admin' || actor.memberships.some((m) => m.organizationId === orgId)
  const org = visible
    ? await db.organization.findUnique({ where: { id: orgId }, select: { id: true } })
    : null
  if (!org) throw new NotFoundError(ORG_NOT_FOUND)
  if (!can(actor, orgId, action)) throw new ForbiddenError()
}
