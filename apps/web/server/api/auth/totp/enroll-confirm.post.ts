import { InvalidTotpError } from '@central/core'
import { z } from 'zod'
import { patchSession, readSession, requireActor } from '../../../utils/auth'
import { defineApiHandler, readValidated } from '../../../utils/errors'
import { useServices } from '../../../utils/services'

const Body = z.object({ code: z.string().regex(/^\d{6}$/) })

export default defineApiHandler(async (event) => {
  const actor = await requireActor(event, { allowStages: ['totp_enroll', 'full'] })
  const { code } = await readValidated(event, Body)
  const secret = (await readSession(event))?.secure.pendingTotpSecret
  if (!secret) throw new InvalidTotpError('Inicie a configuração do 2FA novamente.')
  await useServices().identity.confirmTotpEnrollment(actor.userId, secret, code)
  await patchSession(event, { stage: 'full', pendingTotpSecret: null })
  return { stage: 'full' as const }
})
