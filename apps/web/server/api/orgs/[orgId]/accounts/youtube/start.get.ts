import { createOAuthState } from '@central/core'
import { z } from 'zod'
import { requireAccountsManage } from '../../../../../utils/accounts-auth'
import { defineApiHandler, paramsValidated } from '../../../../../utils/errors'
import { useServices } from '../../../../../utils/services'

const Params = z.object({ orgId: z.uuid() })

export default defineApiHandler(async (event) => {
  const { orgId } = paramsValidated(event, Params)
  // Autoriza antes de exigir a configuração: nada externo acontece sem permissão.
  const actor = await requireAccountsManage(event, orgId)
  const { db, google } = useServices()
  if (!google) {
    throw createError({ statusCode: 503, message: 'Integração com o Google não configurada.' })
  }
  const { state, codeVerifier } = await createOAuthState(db, {
    provider: 'youtube',
    organizationId: orgId,
    userId: actor.userId,
  })
  return sendRedirect(event, google.authorizeUrl(state, codeVerifier), 302)
})
