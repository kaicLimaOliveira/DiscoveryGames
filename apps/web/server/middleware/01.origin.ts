import { randomUUID } from 'node:crypto'
import { withContext } from '@central/shared'
import { useWebConfig } from '../utils/config'
import { setSecurityHeaders } from '../utils/security'
import { useServices } from '../utils/services'

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/

export default defineEventHandler((event) => {
  const incoming = getRequestHeader(event, 'x-request-id')
  const requestId = incoming && REQUEST_ID.test(incoming) ? incoming : randomUUID()
  event.context.requestId = requestId
  // userId é acrescentado pelo middleware de sessão, quando houver ator.
  event.context.log = withContext(useServices().logger, { requestId })
  setResponseHeader(event, 'X-Request-Id', requestId)
  setSecurityHeaders(event)

  const origin = getRequestHeader(event, 'origin')
  if (MUTATING.has(event.method) && origin !== useWebConfig().APP_ORIGIN) {
    throw createError({ statusCode: 403, message: 'Origem não permitida.' })
  }
})
