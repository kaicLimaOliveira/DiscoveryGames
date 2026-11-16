export default defineNuxtRouteMiddleware(async (to) => {
  const { loggedIn } = useUserSession()
  const me = useMe()

  // Sem cookie de sessão: nem consulta o servidor.
  me.value = null
  if (loggedIn.value) {
    try {
      me.value = await useRequestFetch()<Me>('/api/auth/me')
    } catch (err) {
      // Só 401 significa "sem sessão válida"; qualquer outro erro vai para a página de erro.
      const status =
        (err as { statusCode?: number; status?: number }).statusCode ??
        (err as { status?: number }).status
      if (status !== 401) {
        throw createError({
          statusCode: status ?? 500,
          statusMessage: 'Não foi possível verificar a sessão.',
          fatal: true,
        })
      }
    }
  }

  const path = to.path
  if (!me.value) return path === '/login' ? undefined : navigateTo('/login')
  if (me.value.stage !== 'full') return path === '/2fa' ? undefined : navigateTo('/2fa')
  if (path === '/login' || path === '/2fa') return navigateTo('/')
  if (path.startsWith('/admin') && !me.value.isAdmin) return navigateTo('/')
})
