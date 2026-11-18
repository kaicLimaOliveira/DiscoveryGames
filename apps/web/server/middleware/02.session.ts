import { loadActor } from '@central/core'
import { withContext } from '@central/shared'
import type { H3Event } from 'h3'
import {
  SESSION_REFRESH_MS,
  patchSession,
  readSession,
  type SessionActor,
  type SessionData,
} from '../utils/auth'
import { useServices } from '../utils/services'

// Rotas de /api/** que não exigem sessão.
const PUBLIC = new Set(['/api/health', '/api/auth/login'])
// Rota do nuxt-auth-utils (useUserSession): não exige cookie, mas um cookie revogado não
// pode continuar devolvendo o usuário.
const AUTH_UTILS_SESSION = '/api/_auth/session'

/** Sessão + ator válidos (usuário ativo e mesma sessionVersion), ou null. */
async function validSession(
  event: H3Event,
): Promise<{ session: SessionData | null; actor: SessionActor | null }> {
  const session = await readSession(event)
  if (!session) return { session, actor: null }
  const actor = await loadActor(useServices().db, session.user.id)
  if (!actor || actor.sessionVersion !== session.secure.sessionVersion)
    return { session, actor: null }
  return { session, actor }
}

export default defineEventHandler(async (event) => {
  const path = event.path.split('?')[0]!.toLowerCase()
  if (!path.startsWith('/api/') || PUBLIC.has(path)) return

  const { session, actor } = await validSession(event)

  if (path === AUTH_UTILS_SESSION) {
    if (session && !actor) {
      // Responde aqui: o handler do módulo releria o cookie da requisição.
      await clearUserSession(event)
      return {}
    }
    return
  }

  if (!session || !actor) {
    if (session) await clearUserSession(event)
    throw createError({ statusCode: 401, message: 'Não autenticado.' })
  }

  event.context.actor = actor
  event.context.log = withContext(event.context.log ?? useServices().logger, {
    userId: actor.userId,
  })

  if (Date.now() - session.secure.lastSeenAt > SESSION_REFRESH_MS) await patchSession(event, {})
})
