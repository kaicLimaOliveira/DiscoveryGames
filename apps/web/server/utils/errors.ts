import {
  ConflictError,
  ForbiddenError,
  InvalidCredentialsError,
  InvalidTotpError,
  LastAdminError,
  TooManyAttemptsError,
  ValidationError,
} from '@central/core'
import type { EventHandler, EventHandlerRequest, H3Event } from 'h3'
import { z } from 'zod'

/** Mensagem fixa do login (não revela se o e-mail existe). */
export const INVALID_CREDENTIALS_MESSAGE = 'E-mail ou senha inválidos'

function zodFields(err: z.ZodError): string[] {
  return [...new Set(err.issues.map((i) => i.path.join('.') || '(body)'))]
}

/**
 * Único ponto de tradução de erros de domínio para HTTP. Erros desconhecidos viram
 * 500 genérico (registrado no log, sem mensagem interna na resposta).
 */
export function toHttpError(event: H3Event, err: unknown): Error {
  if (isError(err)) return err
  if (err instanceof InvalidCredentialsError) {
    return createError({ statusCode: 401, message: INVALID_CREDENTIALS_MESSAGE })
  }
  if (err instanceof TooManyAttemptsError) {
    setResponseHeader(event, 'Retry-After', Math.max(1, Math.ceil(err.retryAfterMs / 1000)))
    return createError({ statusCode: 429, message: err.message })
  }
  if (err instanceof InvalidTotpError) return createError({ statusCode: 400, message: err.message })
  if (err instanceof ForbiddenError) return createError({ statusCode: 403, message: err.message })
  if (err instanceof ConflictError || err instanceof LastAdminError) {
    return createError({ statusCode: 409, message: err.message })
  }
  if (err instanceof ValidationError) return createError({ statusCode: 422, message: err.message })
  if (err instanceof z.ZodError) {
    return createError({
      statusCode: 422,
      message: 'Dados inválidos.',
      data: { fields: zodFields(err) },
    })
  }
  event.context.log?.error({ err }, 'unhandled error')
  return createError({ statusCode: 500, message: 'Erro interno.' })
}

/** `defineEventHandler` com o mapeamento de erros de domínio aplicado. */
export function defineApiHandler<T>(
  handler: (event: H3Event) => Promise<T> | T,
): EventHandler<EventHandlerRequest, Promise<T>> {
  return defineEventHandler(async (event) => {
    try {
      return await handler(event)
    } catch (err) {
      throw toHttpError(event, err)
    }
  })
}

/** Lê e valida o corpo JSON com zod (422 em caso de falha). */
export async function readValidated<S extends z.ZodTypeAny>(
  event: H3Event,
  schema: S,
): Promise<z.infer<S>> {
  const body: unknown = await readBody(event).catch(() => undefined)
  return schema.parse(body ?? {})
}

/** Valida os parâmetros de rota com zod (422 em caso de falha). */
export function paramsValidated<S extends z.ZodTypeAny>(event: H3Event, schema: S): z.infer<S> {
  return schema.parse(getRouterParams(event, { decode: true }))
}
