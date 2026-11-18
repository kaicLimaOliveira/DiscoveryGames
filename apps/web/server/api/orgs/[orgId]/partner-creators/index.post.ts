import { z } from 'zod'
import { requireActor } from '../../../../utils/auth'
import { defineApiHandler, paramsValidated, readValidated } from '../../../../utils/errors'
import { useServices } from '../../../../utils/services'

const Params = z.object({ orgId: z.uuid() })
const Body = z
  .object({
    name: z.string().min(1).max(200),
    channels: z.array(z.string().max(300)).max(30),
    authorizationUrl: z.string().max(2000).nullable().optional(),
    authorizationKey: z.string().max(300).nullable().optional(),
    notes: z.string().max(5000).optional(),
  })
  .strict()

export default defineApiHandler(async (event) => {
  const actor = await requireActor(event)
  const { orgId } = paramsValidated(event, Params)
  const body = await readValidated(event, Body)
  const result = await useServices().partnerCreators.create(actor, orgId, body)
  setResponseStatus(event, 201)
  return result
})
