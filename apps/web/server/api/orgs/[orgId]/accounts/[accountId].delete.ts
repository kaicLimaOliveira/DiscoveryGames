import { z } from 'zod'
import { requireActor } from '../../../../utils/auth'
import { defineApiHandler, paramsValidated } from '../../../../utils/errors'
import { useServices } from '../../../../utils/services'

const Params = z.object({ orgId: z.uuid(), accountId: z.uuid() })

// Nenhuma plataforma revoga nada por enquanto (o revoke do Google entra na Task 6).
export default defineApiHandler(async (event) => {
  const actor = await requireActor(event)
  const { orgId, accountId } = paramsValidated(event, Params)
  await useServices().accounts.disconnect(actor, orgId, accountId)
  setResponseStatus(event, 204)
  return null
})
