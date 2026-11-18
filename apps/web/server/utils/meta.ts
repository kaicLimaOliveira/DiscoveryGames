import { can, NotFoundError, ValidationError, type Actor } from '@central/core'
import type { MetaGraphClient, MetaPage } from '@central/platforms'
import { PermanentError, TransientError } from '@central/shared'
import type { H3Event } from 'h3'
import { requireActor } from './auth'
import { useServices } from './services'

/**
 * Autoriza o gerenciamento de contas da organização (404 para quem não enxerga a
 * organização, 403 para quem enxerga sem permissão) e só então exige a Meta configurada (503).
 * A ordem importa: nenhuma chamada externa acontece antes da autorização.
 */
export async function requireMetaManage(
  event: H3Event,
  orgId: string,
): Promise<{ actor: Actor; graph: MetaGraphClient }> {
  const actor = await requireActor(event)
  const { db, metaGraph } = useServices()
  const visible =
    actor.globalRole === 'admin' || actor.memberships.some((m) => m.organizationId === orgId)
  const org = visible
    ? await db.organization.findUnique({ where: { id: orgId }, select: { id: true } })
    : null
  if (!org) throw new NotFoundError('Organização não encontrada.')
  if (!can(actor, orgId, 'accounts.manage')) {
    throw createError({ statusCode: 403, message: 'Você não tem permissão para esta ação.' })
  }
  if (!metaGraph) {
    throw createError({ statusCode: 503, message: 'Integração com a Meta não configurada.' })
  }
  return { actor, graph: metaGraph }
}

/** Erros permanentes da Meta viram 422; indisponibilidade vira 502. Mensagens sem token. */
export async function discoverPagesOrThrow(
  graph: MetaGraphClient,
  token: string,
): Promise<MetaPage[]> {
  try {
    return await graph.discoverPages(token)
  } catch (err) {
    if (err instanceof PermanentError) throw new ValidationError(err.message)
    if (err instanceof TransientError) {
      throw createError({ statusCode: 502, message: 'A Meta não respondeu. Tente de novo.' })
    }
    throw err
  }
}
