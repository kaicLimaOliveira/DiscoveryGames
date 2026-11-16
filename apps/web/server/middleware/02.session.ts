import { loadActor } from '@central/core'
import { withContext } from '@central/shared'
import { SESSION_REFRESH_MS, patchSession, readSession } from '../utils/auth'
import { useServices } from '../utils/services'

// Rotas de /api/** que não exigem sessão. /api/_auth/session é do nuxt-auth-utils (devolve a
// sessão pública ou {} e já remove `secure`).
const PUBLIC = new Set(['/api/health', '/api/auth/login', '/api/_auth/session'])

export default defineEventHandler(async (event) => {
  const path = event.path.split('?')[0]!.toLowerCase()
  if (!path.startsWith('/api/') || PUBLIC.has(path)) return

  const session = await readSession(event)
  const actor = session ? await loadActor(useServices().db, session.user.id) : null
  if (!session || !actor || actor.sessionVersion !== session.secure.sessionVersion) {
    if (session) await clearUserSession(event)
    throw createError({ statusCode: 401, message: 'Não autenticado.' })
  }

  event.context.actor = actor
  event.context.log = withContext(event.context.log ?? useServices().logger, {
    userId: actor.userId,
  })

  if (Date.now() - session.secure.lastSeenAt > SESSION_REFRESH_MS) await patchSession(event, {})
})
