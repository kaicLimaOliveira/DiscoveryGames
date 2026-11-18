import { z } from 'zod'
import { requireActor } from '../../../../../utils/auth'
import { defineApiHandler, paramsValidated } from '../../../../../utils/errors'
import { useServices } from '../../../../../utils/services'

const Params = z.object({ orgId: z.uuid(), sourceId: z.uuid() })

export default defineApiHandler(async (event) => {
  const actor = await requireActor(event)
  const { orgId, sourceId } = paramsValidated(event, Params)
  await useServices().sources.abandonUpload(actor, orgId, sourceId)
  setResponseStatus(event, 204)
  return null
})
