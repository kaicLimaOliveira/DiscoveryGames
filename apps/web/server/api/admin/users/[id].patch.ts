import { z } from 'zod'
import { requirePermission } from '../../../utils/auth'
import { defineApiHandler, paramsValidated, readValidated } from '../../../utils/errors'
import { useServices } from '../../../utils/services'

const Params = z.object({ id: z.uuid() })
const Body = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    status: z.enum(['active', 'disabled']).optional(),
    globalRole: z.enum(['admin', 'member']).optional(),
  })
  .strict()

export default defineApiHandler(async (event) => {
  const actor = await requirePermission(event, null, 'users.manage')
  const { id } = paramsValidated(event, Params)
  const body = await readValidated(event, Body)
  await useServices().identity.updateUser(actor, id, body)
  setResponseStatus(event, 204)
  return null
})
