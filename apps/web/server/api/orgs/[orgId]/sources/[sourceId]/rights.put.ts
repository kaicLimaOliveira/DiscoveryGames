import { z } from 'zod'
import { requireActor } from '../../../../../utils/auth'
import { defineApiHandler, paramsValidated, readValidated } from '../../../../../utils/errors'
import { RightsBody } from '../../../../../utils/cutter-schemas'
import { useServices } from '../../../../../utils/services'

const Params = z.object({ orgId: z.uuid(), sourceId: z.uuid() })

export default defineApiHandler(async (event) => {
  const actor = await requireActor(event)
  const { orgId, sourceId } = paramsValidated(event, Params)
  const rights = await readValidated(event, RightsBody)
  return useServices().sources.changeRights(actor, orgId, sourceId, rights)
})
