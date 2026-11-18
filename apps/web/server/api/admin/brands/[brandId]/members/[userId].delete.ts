import { z } from 'zod'
import { requirePermission } from '../../../../../utils/auth'
import { defineApiHandler, paramsValidated } from '../../../../../utils/errors'
import { useServices } from '../../../../../utils/services'

const Params = z.object({ brandId: z.uuid(), userId: z.uuid() })

export default defineApiHandler(async (event) => {
  const actor = await requirePermission(event, null, 'users.manage')
  const { brandId, userId } = paramsValidated(event, Params)
  await useServices().identity.setMembership(actor, brandId, userId, null)
  setResponseStatus(event, 204)
  return null
})
