import { z } from 'zod'
import { requireActor } from '../../../../utils/auth'
import { defineApiHandler, paramsValidated } from '../../../../utils/errors'
import { useServices } from '../../../../utils/services'

const Params = z.object({ orgId: z.uuid(), id: z.uuid() })

export default defineApiHandler(async (event) => {
  const actor = await requireActor(event)
  const { orgId, id } = paramsValidated(event, Params)
  await useServices().partnerCreators.remove(actor, orgId, id)
  setResponseStatus(event, 204)
  return null
})
