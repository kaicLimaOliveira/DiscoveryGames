import { defineApiHandler } from '../../utils/errors'
import { readSession, requireActor } from '../../utils/auth'

/** Usuário da sessão em qualquer estágio; o papel vem do banco (o cookie não guarda papel). */
export default defineApiHandler(async (event) => {
  const actor = await requireActor(event, {
    allowStages: ['full', 'totp_pending', 'totp_enroll'],
  })
  const session = await readSession(event)
  const user = session!.user
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    stage: user.stage,
    isAdmin: actor.globalRole === 'admin',
    // Só para a UI esconder ações; a autorização real continua no servidor.
    memberships: actor.memberships.map((m) => ({ organizationId: m.organizationId, role: m.role })),
  }
})
