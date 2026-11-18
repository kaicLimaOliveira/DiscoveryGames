import { z } from 'zod'
import { requireActor } from '../../../utils/auth'
import { defineApiHandler, paramsValidated, readValidated } from '../../../utils/errors'
import { useServices } from '../../../utils/services'

const Params = z.object({ orgId: z.uuid() })
const Body = z.object({ contentType: z.string().min(1).max(100) }).strict()

export default defineApiHandler(async (event) => {
  const actor = await requireActor(event)
  const { orgId } = paramsValidated(event, Params)
  const { contentType } = await readValidated(event, Body)
  return useServices().sources.presignEvidenceUpload(actor, orgId, contentType)
})
