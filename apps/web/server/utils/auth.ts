import { randomUUID } from 'node:crypto'
import { can, type Action, type Actor, type LoginStage } from '@central/core'
import type { H3Event } from 'h3'
import type { Logger } from './services'
import { useWebConfig } from './config'

export type SessionActor = Actor & { sessionVersion: number }

declare module 'h3' {
  interface H3EventContext {
    requestId?: string
    log?: Logger
    actor?: SessionActor
  }
}

export type SessionData = {
  user: { id: string; name: string; email: string; stage: LoginStage }
  secure: { sessionVersion: number; pendingTotpSecret?: string; lastSeenAt: number }
}

/** Intervalo mínimo entre regravações do cookie (renovação deslizante das 12 h). */
export const SESSION_REFRESH_MS = 5 * 60 * 1000

/**
 * Regrava a sessão inteira com novo id e novo `createdAt`.
 *
 * O h3 1.x expira a sessão por `createdAt + maxAge` e o `replaceUserSession` preserva o
 * `createdAt` original (relê o cookie da requisição). Para que as 12 h sejam deslizantes e o
 * id mude a cada login (anti-fixação), reinicia-se o estado da sessão já carregada no
 * contexto antes de gravar com `setUserSession`.
 */
export async function writeSession(event: H3Event, data: SessionData): Promise<void> {
  await getUserSession(event)
  const name = useRuntimeConfig(event).session.name as string
  const raw = (
    event.context.sessions as
      Record<string, { id: string; createdAt: number; data: Record<string, unknown> }> | undefined
  )?.[name]
  if (raw) {
    raw.id = randomUUID()
    raw.createdAt = Date.now()
    for (const key of Object.keys(raw.data)) Reflect.deleteProperty(raw.data, key)
  }
  await setUserSession(event, data)
}

/** Sessão atual completa (inclui `secure`), ou `null` se não houver usuário. */
export async function readSession(event: H3Event): Promise<SessionData | null> {
  const session = await getUserSession(event)
  if (!session.user || !session.secure) return null
  return { user: session.user, secure: session.secure }
}

export async function patchSession(
  event: H3Event,
  patch: { stage?: LoginStage; sessionVersion?: number; pendingTotpSecret?: string | null },
): Promise<void> {
  const current = await readSession(event)
  if (!current) throw createError({ statusCode: 401, message: 'Sessão inválida.' })
  const secure: SessionData['secure'] = {
    sessionVersion: patch.sessionVersion ?? current.secure.sessionVersion,
    lastSeenAt: Date.now(),
  }
  const pending =
    patch.pendingTotpSecret === undefined
      ? current.secure.pendingTotpSecret
      : (patch.pendingTotpSecret ?? undefined)
  if (pending) secure.pendingTotpSecret = pending
  await writeSession(event, {
    user: { ...current.user, stage: patch.stage ?? current.user.stage },
    secure,
  })
}

/** IP do cliente; com TRUST_PROXY, o primeiro de X-Forwarded-For (definido pelo Caddy). */
export function clientIp(event: H3Event): string {
  const ip = getRequestIP(event, { xForwardedFor: useWebConfig().TRUST_PROXY })
  return ip ?? 'unknown'
}

/**
 * Ator autenticado (carregado pelo middleware `02.session`). Por padrão exige `stage: 'full'`;
 * rotas do fluxo de 2FA liberam outros estágios.
 */
export async function requireActor(
  event: H3Event,
  opts: { allowStages?: LoginStage[] } = {},
): Promise<Actor> {
  const actor = event.context.actor
  const session = await readSession(event)
  if (!actor || !session) throw createError({ statusCode: 401, message: 'Não autenticado.' })
  const allowed = opts.allowStages ?? ['full']
  if (!allowed.includes(session.user.stage)) {
    throw createError({ statusCode: 403, message: 'Conclua a verificação em duas etapas.' })
  }
  return actor
}

export async function requirePermission(
  event: H3Event,
  brandId: string | null,
  action: Action,
): Promise<Actor> {
  const actor = await requireActor(event)
  if (!can(actor, brandId, action)) {
    throw createError({ statusCode: 403, message: 'Você não tem permissão para esta ação.' })
  }
  return actor
}
