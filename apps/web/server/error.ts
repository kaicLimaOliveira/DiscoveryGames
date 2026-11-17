import { setSecurityHeaders } from './utils/security'
import { useServices } from './utils/services'

/**
 * Erros de /api/**: resposta JSON padrão do Nitro (mensagem genérica para erros não
 * tratados), mas com os cabeçalhos de segurança do app. Demais rotas seguem para o
 * handler de erro do Nuxt (próximo da cadeia). Erros 5xx/não tratados vão para o logger estruturado.
 */
export default defineNitroErrorHandler(async (error, event, { defaultHandler }) => {
  if (!event.path.startsWith('/api/')) return
  // Erros fora do defineApiHandler (middleware, readSession...) passam por aqui: registra pelo
  // logger estruturado (requestId, redação) e silencia o console.error em texto puro do Nitro.
  // 500 criados por toHttpError não são `unhandled` e já foram registrados lá.
  if (error.unhandled || error.fatal) {
    const log = event.context.log ?? useServices().logger
    log.error({ err: error }, 'unhandled error')
  }
  const res = await defaultHandler(error, event, { silent: true })
  setResponseHeaders(event, res.headers)
  setSecurityHeaders(event)
  setResponseStatus(event, res.status, res.statusText)
  return send(event, JSON.stringify(res.body))
})
