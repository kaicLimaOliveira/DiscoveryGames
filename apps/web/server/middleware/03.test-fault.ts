/**
 * Gancho só para testes: com WEB_TEST_FAULT=1, GET /api/health com o cabeçalho x-test-fault
 * lança um erro fora do defineApiHandler (cobre o caminho de erros não tratados do middleware).
 * Sem a variável de ambiente (produção) o middleware não faz nada.
 */
export default defineEventHandler((event) => {
  if (process.env.WEB_TEST_FAULT !== '1') return
  if (event.path === '/api/health' && getRequestHeader(event, 'x-test-fault')) {
    throw new Error('falha injetada')
  }
})
