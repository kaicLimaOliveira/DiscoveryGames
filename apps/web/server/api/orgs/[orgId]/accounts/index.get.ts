import { z } from 'zod'
import { requireActor } from '../../../../utils/auth'
import { defineApiHandler, paramsValidated } from '../../../../utils/errors'
import { useServices } from '../../../../utils/services'

const Params = z.object({ orgId: z.uuid() })

export default defineApiHandler(async (event) => {
  const actor = await requireActor(event)
  const { orgId } = paramsValidated(event, Params)
  return { accounts: await useServices().accounts.list(actor, orgId) }
})
