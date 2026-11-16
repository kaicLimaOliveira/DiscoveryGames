export default defineNuxtRouteMiddleware(async (to) => {
  const { loggedIn } = useUserSession()
  const me = useMe()

  // Sem cookie de sessão: nem consulta o servidor.
  me.value = loggedIn.value ? await useRequestFetch()<Me>('/api/auth/me').catch(() => null) : null

  const path = to.path
  if (!me.value) return path === '/login' ? undefined : navigateTo('/login')
  if (me.value.stage !== 'full') return path === '/2fa' ? undefined : navigateTo('/2fa')
  if (path === '/login' || path === '/2fa') return navigateTo('/')
  if (path.startsWith('/admin') && !me.value.isAdmin) return navigateTo('/')
})
