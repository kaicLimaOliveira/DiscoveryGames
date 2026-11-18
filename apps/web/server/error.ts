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
  // O corpo padrão traz a URL completa; a query pode ter code/state do OAuth. Só o caminho sai.
  const body = res.body as Record<string, unknown> | null
  if (body && typeof body === 'object') {
    const query = event.path.includes('?') ? event.path.slice(event.path.indexOf('?')) : ''
    for (const key of ['url', 'message', 'statusMessage']) {
      const value = body[key]
      if (typeof value !== 'string') continue
      // O 404 padrão também cita o caminho completo na mensagem.
      body[key] =
        key === 'url' ? event.path.split('?')[0] : query ? value.replaceAll(query, '') : value
    }
    const data = body.data as Record<string, unknown> | undefined
    if (data && typeof data.path === 'string') data.path = data.path.split('?')[0]
  }
  return send(event, JSON.stringify(body))
})
