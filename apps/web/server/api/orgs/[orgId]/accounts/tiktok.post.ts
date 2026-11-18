import { z } from 'zod'
import { requireActor } from '../../../../utils/auth'
import { defineApiHandler, paramsValidated, readValidated } from '../../../../utils/errors'
import { useServices } from '../../../../utils/services'

const Params = z.object({ orgId: z.uuid() })
const Body = z.object({ handle: z.string().max(100) })

export default defineApiHandler(async (event) => {
  const actor = await requireActor(event)
  const { orgId } = paramsValidated(event, Params)
  const { handle } = await readValidated(event, Body)
  const account = await useServices().accounts.linkTiktok(actor, orgId, handle)
  setResponseStatus(event, 201)
  return account
})
