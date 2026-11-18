import { createOAuthState } from '@central/core'
import { z } from 'zod'
import { requireAccountsManage } from '../../../../../utils/accounts-auth'
import { toHttpError } from '../../../../../utils/errors'
import { useServices } from '../../../../../utils/services'

const Params = z.object({ orgId: z.uuid() })

const MSG = {
  notConfigured: 'Integração com o Google não configurada.',
  forbidden: 'Você não tem permissão para conectar contas nesta organização.',
  notFound: 'Organização não encontrada.',
} as const

const redirectError = (event: Parameters<typeof sendRedirect>[0], base: string, msg: string) =>
  sendRedirect(event, `${base}?error=${encodeURIComponent(msg)}`, 302)

// Navegação de página inteira (não fetch): erro de autorização ou configuração vira redirect
// com mensagem fixa, nunca JSON cru na tela do navegador.
export default defineEventHandler(async (event) => {
  try {
    const { orgId } = Params.parse(getRouterParams(event, { decode: true }))
    // Autoriza antes de exigir a configuração: nada externo acontece sem permissão.
    let actor
    try {
      actor = await requireAccountsManage(event, orgId)
    } catch (err) {
      if (isError(err) && err.statusCode === 403) {
        return redirectError(event, `/orgs/${orgId}/accounts`, MSG.forbidden)
      }
      if (isError(err) && err.statusCode === 404) return redirectError(event, '/orgs', MSG.notFound)
      throw err
    }
    const { db, google } = useServices()
    if (!google) return redirectError(event, `/orgs/${orgId}/accounts`, MSG.notConfigured)
    const { state, codeVerifier } = await createOAuthState(db, {
      provider: 'youtube',
      organizationId: orgId,
      userId: actor.userId,
    })
    return sendRedirect(event, google.authorizeUrl(state, codeVerifier), 302)
  } catch (err) {
    throw toHttpError(event, err)
  }
})
