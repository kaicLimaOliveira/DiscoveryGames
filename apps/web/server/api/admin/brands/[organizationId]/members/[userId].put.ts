import { z } from 'zod'
import { requirePermission } from '../../../../../utils/auth'
import { defineApiHandler, paramsValidated, readValidated } from '../../../../../utils/errors'
import { useServices } from '../../../../../utils/services'

const Params = z.object({ organizationId: z.uuid(), userId: z.uuid() })
const Body = z.object({ role: z.enum(['viewer', 'editor', 'approver', 'admin']) })

export default defineApiHandler(async (event) => {
  const actor = await requirePermission(event, null, 'users.manage')
  const { organizationId, userId } = paramsValidated(event, Params)
  const { role } = await readValidated(event, Body)
  await useServices().identity.setMembership(actor, organizationId, userId, role)
  setResponseStatus(event, 204)
  return null
})
