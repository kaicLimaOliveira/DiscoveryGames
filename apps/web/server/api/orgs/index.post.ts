import { z } from 'zod'
import { requirePermission } from '../../utils/auth'
import { defineApiHandler, readValidated } from '../../utils/errors'
import { useServices } from '../../utils/services'

const Body = z.object({
  name: z.string().trim().min(1).max(200),
  slug: z.string().trim().min(1).max(60).optional(),
  timezone: z.string().max(100).optional(),
  locale: z.string().max(35).optional(),
})

export default defineApiHandler(async (event) => {
  const actor = await requirePermission(event, null, 'organizations.create')
  const body = await readValidated(event, Body)
  const organization = await useServices().organizations.create(actor, body)
  setResponseStatus(event, 201)
  return organization
})
