import { z } from 'zod'
import { requireActor } from '../../../../utils/auth'
import { defineApiHandler, paramsValidated, readValidated } from '../../../../utils/errors'
import { ParamsBody, RightsBody } from '../../../../utils/cutter-schemas'
import { useWebConfig } from '../../../../utils/config'
import { useServices } from '../../../../utils/services'

const Params = z.object({ orgId: z.uuid() })
const Body = z
  .object({
    title: z.string().min(1).max(200),
    url: z.string().min(1).max(2000),
    rights: RightsBody,
    params: ParamsBody.optional(),
  })
  .strict()

export default defineApiHandler(async (event) => {
  const actor = await requireActor(event)
  const { orgId } = paramsValidated(event, Params)
  const body = await readValidated(event, Body)
  const linkEnabled = useWebConfig().YTDLP_ENABLED
  const result = await useServices().sources.createFromLink(actor, orgId, body, { linkEnabled })
  setResponseStatus(event, 201)
  return result
})
