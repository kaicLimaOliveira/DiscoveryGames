import { z } from 'zod'
import { patchSession, requireActor } from '../../utils/auth'
import { defineApiHandler, readValidated } from '../../utils/errors'
import { useServices } from '../../utils/services'

const Body = z.object({
  current: z.string().min(1).max(1024),
  next: z.string().min(12).max(1024),
})

export default defineApiHandler(async (event) => {
  const actor = await requireActor(event)
  const { current, next } = await readValidated(event, Body)
  const { sessionVersion } = await useServices().identity.changePassword(
    actor.userId,
    current,
    next,
  )
  // Regrava esta sessão com a nova versão; as demais passam a receber 401.
  await patchSession(event, { sessionVersion })
  return { ok: true }
})
