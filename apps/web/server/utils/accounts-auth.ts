import { can, NotFoundError, type Actor } from '@central/core'
import type { H3Event } from 'h3'
import { requireActor } from './auth'
import { useServices } from './services'

/**
 * Autoriza o gerenciamento de contas da organização: 404 para quem não enxerga a organização,
 * 403 para quem enxerga sem permissão. Deve vir antes de qualquer chamada externa.
 */
export async function requireAccountsManage(event: H3Event, orgId: string): Promise<Actor> {
  const actor = await requireActor(event)
  const visible =
    actor.globalRole === 'admin' || actor.memberships.some((m) => m.organizationId === orgId)
  const org = visible
    ? await useServices().db.organization.findUnique({ where: { id: orgId }, select: { id: true } })
    : null
  if (!org) throw new NotFoundError('Organização não encontrada.')
  if (!can(actor, orgId, 'accounts.manage')) {
    throw createError({ statusCode: 403, message: 'Você não tem permissão para esta ação.' })
  }
  return actor
}
