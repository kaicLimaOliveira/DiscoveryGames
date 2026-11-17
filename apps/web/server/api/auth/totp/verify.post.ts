import { z } from 'zod'
import { clientIp, patchSession, requireActor } from '../../../utils/auth'
import { defineApiHandler, readValidated } from '../../../utils/errors'
import { useServices } from '../../../utils/services'

const Body = z.object({ code: z.string().regex(/^\d{6}$/) })

export default defineApiHandler(async (event) => {
  const actor = await requireActor(event, { allowStages: ['totp_pending'] })
  const { code } = await readValidated(event, Body)
  await useServices().identity.verifyLoginTotp(actor.userId, code, clientIp(event))
  await patchSession(event, { stage: 'full' })
  return { stage: 'full' as const }
})
