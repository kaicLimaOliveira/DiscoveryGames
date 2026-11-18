import { requireOrgAccess, type Actor } from '@central/core'
import type { H3Event } from 'h3'
import { requireActor } from './auth'
import { toHttpError } from './errors'
import { useServices } from './services'

/**
 * Autoriza o gerenciamento de contas da organização: 404 para quem não enxerga a organização,
 * 403 para quem enxerga sem permissão. Deve vir antes de qualquer chamada externa.
 */
export async function requireAccountsManage(event: H3Event, orgId: string): Promise<Actor> {
  const actor = await requireActor(event)
  try {
    await requireOrgAccess(useServices().db, actor, orgId, 'accounts.manage')
  } catch (err) {
    throw toHttpError(event, err)
  }
  return actor
}
