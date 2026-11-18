import { z } from 'zod'
import { requireActor } from '../../../../utils/auth'
import { defineApiHandler, paramsValidated, readValidated } from '../../../../utils/errors'
import { useServices } from '../../../../utils/services'

const Params = z.object({ orgId: z.uuid(), id: z.uuid() })
const Body = z
  .object({
    name: z.string().min(1).max(200),
    channels: z.array(z.string().max(300)).max(30),
    authorizationUrl: z.string().max(2000).nullable(),
    authorizationKey: z.string().max(300).nullable(),
    notes: z.string().max(5000),
  })
  .partial()
  .strict()

export default defineApiHandler(async (event) => {
  const actor = await requireActor(event)
  const { orgId, id } = paramsValidated(event, Params)
  const patch = await readValidated(event, Body)
  return useServices().partnerCreators.update(actor, orgId, id, patch)
})
