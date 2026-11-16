import { z } from 'zod'
import { requirePermission } from '../../utils/auth'
import { defineApiHandler, readValidated } from '../../utils/errors'
import { useServices } from '../../utils/services'

const Body = z.object({
  email: z.email().max(320),
  name: z.string().trim().min(1).max(200),
  password: z.string().min(12).max(1024),
  globalRole: z.enum(['admin', 'member']).optional(),
})

export default defineApiHandler(async (event) => {
  const actor = await requirePermission(event, null, 'users.manage')
  const body = await readValidated(event, Body)
  const { id } = await useServices().identity.createUser(actor, body)
  setResponseStatus(event, 201)
  return { id }
})
