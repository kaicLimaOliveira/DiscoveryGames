import { requireActor } from '../../utils/auth'
import { defineApiHandler } from '../../utils/errors'
import { useServices } from '../../utils/services'

export default defineApiHandler(async (event) => {
  const actor = await requireActor(event)
  const organizations = await useServices().organizations.list(actor)
  return { organizations }
})
