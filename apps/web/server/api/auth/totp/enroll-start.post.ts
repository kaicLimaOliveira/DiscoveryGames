import { patchSession, requireActor } from '../../../utils/auth'
import { defineApiHandler } from '../../../utils/errors'
import { useServices } from '../../../utils/services'

export default defineApiHandler(async (event) => {
  const actor = await requireActor(event, { allowStages: ['totp_enroll', 'full'] })
  const { secret, uri } = await useServices().identity.startTotpEnrollment(actor.userId)
  // O segredo pendente fica só em `secure` (cookie selado, nunca exposto ao cliente).
  await patchSession(event, { pendingTotpSecret: secret })
  return { uri }
})
