import { z } from 'zod'
import { requireActor } from '../../../../utils/auth'
import { defineApiHandler, paramsValidated } from '../../../../utils/errors'
import { useServices } from '../../../../utils/services'

const Params = z.object({ orgId: z.uuid(), accountId: z.uuid() })

export default defineApiHandler(async (event) => {
  const actor = await requireActor(event)
  const { orgId, accountId } = paramsValidated(event, Params)
  const { accounts, google } = useServices()
  // Melhor esforço (o serviço registra a falha sem token). Só o YouTube revoga hoje.
  const revoke = async (credential: unknown) => {
    const cred = credential as { kind?: unknown; refreshToken?: unknown } | null
    if (google && cred?.kind === 'google_oauth' && typeof cred.refreshToken === 'string') {
      await google.revoke(cred.refreshToken)
    }
  }
  await accounts.disconnect(actor, orgId, accountId, revoke)
  setResponseStatus(event, 204)
  return null
})
