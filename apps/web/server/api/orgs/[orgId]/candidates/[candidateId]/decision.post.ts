import { z } from 'zod'
import { requireActor } from '../../../../../utils/auth'
import { defineApiHandler, paramsValidated, readValidated } from '../../../../../utils/errors'
import { useServices } from '../../../../../utils/services'

const Params = z.object({ orgId: z.uuid(), candidateId: z.uuid() })
const Body = z.object({ decision: z.enum(['accept', 'reject']) }).strict()

export default defineApiHandler(async (event) => {
  const actor = await requireActor(event)
  const { orgId, candidateId } = paramsValidated(event, Params)
  const { decision } = await readValidated(event, Body)
  return useServices().candidates.decide(actor, orgId, candidateId, decision)
})
