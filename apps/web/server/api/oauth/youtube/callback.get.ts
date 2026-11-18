import {
  can,
  consumeOAuthState,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '@central/core'
import { PermanentError, TransientError } from '@central/shared'
import { z } from 'zod'
import { requireActor } from '../../../utils/auth'
import { defineApiHandler } from '../../../utils/errors'
import { useServices } from '../../../utils/services'

const Query = z.object({
  code: z.string().max(2048).optional(),
  state: z.string().max(256).optional(),
  error: z.string().max(256).optional(),
})

const MSG = {
  invalidState: 'Autorização expirada ou inválida. Tente conectar de novo.',
  denied: 'Você não autorizou o acesso no Google.',
  forbidden: 'Você não tem permissão para esta ação.',
  notConfigured: 'Integração com o Google não configurada.',
  unavailable: 'O Google não respondeu. Tente de novo.',
  generic: 'Não foi possível conectar o canal. Tente de novo.',
} as const

/** Só mensagens fixas entram na URL: nunca o code, o state, tokens ou texto do Google. */
const redirectError = (event: Parameters<typeof sendRedirect>[0], base: string, msg: string) =>
  sendRedirect(event, `${base}?error=${encodeURIComponent(msg)}`, 302)

export default defineApiHandler(async (event) => {
  const actor = await requireActor(event)
  const parsed = Query.safeParse(getQuery(event))
  const { code, state, error } = parsed.success ? parsed.data : {}
  const { db, accounts, google, logger } = useServices()

  if (!state) return redirectError(event, '/orgs', MSG.invalidState)
  let consumed: { organizationId: string; codeVerifier: string }
  try {
    consumed = await consumeOAuthState(db, { state, provider: 'youtube', userId: actor.userId })
  } catch (err) {
    if (err instanceof ValidationError) return redirectError(event, '/orgs', MSG.invalidState)
    throw err
  }
  const { organizationId: orgId, codeVerifier } = consumed
  const back = `/orgs/${orgId}/accounts`

  if (error || !code) return redirectError(event, back, MSG.denied)
  if (!can(actor, orgId, 'accounts.manage')) return redirectError(event, back, MSG.forbidden)
  if (!google) return redirectError(event, back, MSG.notConfigured)

  try {
    const tokens = await google.exchange(code, codeVerifier)
    const channel = await google.myChannel(tokens.accessToken)
    await accounts.upsertLinked(actor, orgId, {
      platform: 'youtube',
      externalId: channel.channelId,
      displayName: channel.title,
      credential: { kind: 'google_oauth', refreshToken: tokens.refreshToken },
      scopes: tokens.scopes,
    })
  } catch (err) {
    if (
      err instanceof PermanentError ||
      err instanceof ConflictError ||
      err instanceof ValidationError ||
      err instanceof NotFoundError
    ) {
      // Mensagens fixas do nosso código (nunca texto do Google).
      return redirectError(event, back, err.message)
    }
    if (err instanceof TransientError) return redirectError(event, back, MSG.unavailable)
    // Sem `err`: pode carregar URL ou corpo com segredos.
    logger.error(
      { errorName: err instanceof Error ? err.name : 'unknown' },
      'falha inesperada no callback do YouTube',
    )
    return redirectError(event, back, MSG.generic)
  }
  return sendRedirect(event, `${back}?connected=youtube`, 302)
})
