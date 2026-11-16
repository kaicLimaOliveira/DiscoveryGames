import { setSecurityHeaders } from './utils/security'

/**
 * Erros de /api/**: resposta JSON padrão do Nitro (mensagem genérica para erros não
 * tratados), mas com os cabeçalhos de segurança do app. Demais rotas seguem para o
 * handler de erro do Nuxt (próximo da cadeia).
 */
export default defineNitroErrorHandler(async (error, event, { defaultHandler }) => {
  if (!event.path.startsWith('/api/')) return
  const res = await defaultHandler(error, event)
  setResponseHeaders(event, res.headers)
  setSecurityHeaders(event)
  setResponseStatus(event, res.status, res.statusText)
  return send(event, JSON.stringify(res.body))
})
