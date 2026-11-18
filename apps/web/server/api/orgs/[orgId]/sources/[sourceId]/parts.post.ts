import { z } from 'zod'
import { requireActor } from '../../../../../utils/auth'
import { defineApiHandler, paramsValidated, readValidated } from '../../../../../utils/errors'
import { useServices } from '../../../../../utils/services'

const Params = z.object({ orgId: z.uuid(), sourceId: z.uuid() })
const Body = z.object({ partNumbers: z.array(z.number().int().min(1)).min(1).max(100) }).strict()

export default defineApiHandler(async (event) => {
  const actor = await requireActor(event)
  const { orgId, sourceId } = paramsValidated(event, Params)
  const { partNumbers } = await readValidated(event, Body)
  return { parts: await useServices().sources.presignParts(actor, orgId, sourceId, partNumbers) }
})
