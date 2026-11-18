import { requirePermission } from '../../utils/auth'
import { defineApiHandler } from '../../utils/errors'
import { useServices } from '../../utils/services'

export default defineApiHandler(async (event) => {
  await requirePermission(event, null, 'users.manage')
  const brands = await useServices().db.brand.findMany({
    orderBy: { name: 'asc' },
    select: { id: true, name: true, slug: true },
  })
  return { brands }
})
