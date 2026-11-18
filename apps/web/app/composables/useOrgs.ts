import type { Me } from './useMe'

export interface OrganizationSummary {
  id: string
  name: string
  slug: string
}

const STORAGE_KEY = 'central:lastOrgId'

function readLast(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

function writeLast(id: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, id)
  } catch {
    // armazenamento indisponível: só não lembra a última organização
  }
}

/**
 * Organizações do usuário e a ativa. A ativa vem do parâmetro `orgId` da rota; fora de uma rota
 * de organização vale a última usada (lembrada no navegador).
 */
export function useOrgs() {
  const route = useRoute()
  const orgs = useState<OrganizationSummary[]>('orgs', () => [])
  const lastOrgId = useState<string | null>('last-org-id', () => null)

  const routeOrgId = computed(() =>
    typeof route.params.orgId === 'string' ? route.params.orgId : null,
  )
  const activeOrgId = computed(() => routeOrgId.value ?? lastOrgId.value)

  if (import.meta.client) {
    if (!lastOrgId.value) lastOrgId.value = readLast()
    watch(
      routeOrgId,
      (id) => {
        if (!id) return
        lastOrgId.value = id
        writeLast(id)
      },
      { immediate: true },
    )
  }

  async function refresh(): Promise<void> {
    const res = await useRequestFetch()<{ organizations: OrganizationSummary[] }>('/api/orgs')
    orgs.value = res.organizations
  }

  return { orgs, activeOrgId, refresh }
}

/** Só para esconder ações na UI; a permissão de verdade é checada no servidor. */
export function useCanManageOrg(orgId: MaybeRefOrGetter<string | null>) {
  const me = useMe()
  return computed(() => {
    if (!me.value) return false
    if (me.value.isAdmin) return true
    const id = toValue(orgId)
    return me.value.memberships.some((m) => m.organizationId === id && m.role === 'admin')
  })
}

const ROLE_RANK = { viewer: 0, editor: 1, approver: 2, admin: 3 } as const

function hasRole(me: Me | null, orgId: string | null, min: keyof typeof ROLE_RANK): boolean {
  if (!me) return false
  if (me.isAdmin) return true
  const m = me.memberships.find((x) => x.organizationId === orgId)
  return !!m && ROLE_RANK[m.role] >= ROLE_RANK[min]
}

/** Só para esconder ações na UI; a permissão de verdade é checada no servidor. */
export function useCanEditOrg(orgId: MaybeRefOrGetter<string | null>) {
  const me = useMe()
  return computed(() => hasRole(me.value, toValue(orgId), 'editor'))
}

export function useCanApproveOrg(orgId: MaybeRefOrGetter<string | null>) {
  const me = useMe()
  return computed(() => hasRole(me.value, toValue(orgId), 'approver'))
}
