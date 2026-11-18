import { requirePermission } from '../../utils/auth'
import { defineApiHandler } from '../../utils/errors'
import { useServices } from '../../utils/services'

export default defineApiHandler(async (event) => {
  const actor = await requirePermission(event, null, 'users.manage')
  // listUsers já devolve só campos públicos (sem hash, segredo TOTP ou step).
  const users = await useServices().identity.listUsers(actor)
  return { users }
})
