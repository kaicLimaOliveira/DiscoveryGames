import { z } from 'zod'
import { requireActor } from '../../../../utils/auth'
import { defineApiHandler, paramsValidated, readValidated } from '../../../../utils/errors'
import { useServices } from '../../../../utils/services'

const Params = z.object({ orgId: z.uuid(), accountId: z.uuid() })
const Body = z.object({ dailyLimit: z.number().nullable() }).strict()

export default defineApiHandler(async (event) => {
  const actor = await requireActor(event)
  const { orgId, accountId } = paramsValidated(event, Params)
  const { dailyLimit } = await readValidated(event, Body)
  return useServices().accounts.setDailyLimit(actor, orgId, accountId, dailyLimit)
})
