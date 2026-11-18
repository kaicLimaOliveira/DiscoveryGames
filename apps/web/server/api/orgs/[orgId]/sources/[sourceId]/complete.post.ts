import { z } from 'zod'
import { requireActor } from '../../../../../utils/auth'
import { defineApiHandler, paramsValidated, readValidated } from '../../../../../utils/errors'
import { useServices } from '../../../../../utils/services'

const Params = z.object({ orgId: z.uuid(), sourceId: z.uuid() })
const Body = z
  .object({
    parts: z
      .array(
        z
          .object({ partNumber: z.number().int().min(1), etag: z.string().min(1).max(200) })
          .strict(),
      )
      .min(1)
      .max(10_000),
  })
  .strict()

export default defineApiHandler(async (event) => {
  const actor = await requireActor(event)
  const { orgId, sourceId } = paramsValidated(event, Params)
  const { parts } = await readValidated(event, Body)
  return useServices().sources.completeUpload(actor, orgId, sourceId, parts)
})
