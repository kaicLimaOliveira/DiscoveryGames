import { z } from 'zod'
import { requireActor } from '../../../../../utils/auth'
import { defineApiHandler, paramsValidated, readValidated } from '../../../../../utils/errors'
import { useServices } from '../../../../../utils/services'

const Params = z.object({ orgId: z.uuid(), candidateId: z.uuid() })
const Body = z
  .object({
    startMs: z.number().int().min(0),
    endMs: z.number().int().min(0),
    layout: z.enum(['face', 'center', 'game_facecam', 'blur_fit']).optional(),
    title: z.string().max(200).optional(),
  })
  .strict()

export default defineApiHandler(async (event) => {
  const actor = await requireActor(event)
  const { orgId, candidateId } = paramsValidated(event, Params)
  const body = await readValidated(event, Body)
  return useServices().candidates.adjust(actor, orgId, candidateId, body)
})
