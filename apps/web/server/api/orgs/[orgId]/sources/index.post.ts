import { z } from 'zod'
import { requireActor } from '../../../../utils/auth'
import { defineApiHandler, paramsValidated, readValidated } from '../../../../utils/errors'
import { ParamsBody, RightsBody } from '../../../../utils/cutter-schemas'
import { useServices } from '../../../../utils/services'

const Params = z.object({ orgId: z.uuid() })
const Body = z
  .object({
    title: z.string().min(1).max(200),
    fileName: z.string().min(1).max(255),
    sizeBytes: z.number().int().positive(),
    contentType: z.string().min(1).max(100),
    rights: RightsBody,
    params: ParamsBody.optional(),
  })
  .strict()

export default defineApiHandler(async (event) => {
  const actor = await requireActor(event)
  const { orgId } = paramsValidated(event, Params)
  const body = await readValidated(event, Body)
  const result = await useServices().sources.createUpload(actor, orgId, body)
  setResponseStatus(event, 201)
  return result
})
