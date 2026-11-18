import type { BrandRole, GlobalRole } from '@central/db'

export type Action =
  | 'library.read'
  | 'content.edit'
  | 'publication.approve'
  | 'publishing.pause'
  | 'accounts.manage'
  | 'settings.manage'
  | 'users.manage'

export const ACTION_MIN_ROLE: Record<Action, BrandRole> = {
  'library.read': 'viewer',
  'content.edit': 'editor',
  'publication.approve': 'approver',
  'publishing.pause': 'approver',
  'accounts.manage': 'admin',
  'settings.manage': 'admin',
  'users.manage': 'admin',
}

export type Actor = {
  userId: string
  globalRole: GlobalRole
  memberships: Array<{ brandId: string; role: BrandRole }>
}

const RANK: Record<BrandRole, number> = { viewer: 0, editor: 1, approver: 2, admin: 3 }

export function can(actor: Actor, brandId: string | null, action: Action): boolean {
  if (actor.globalRole === 'admin') return true
  if (brandId === null) return false
  const m = actor.memberships.find((x) => x.brandId === brandId)
  return m !== undefined && RANK[m.role] >= RANK[ACTION_MIN_ROLE[action]]
}

export function requires2fa(actor: Actor): boolean {
  return (
    actor.globalRole === 'admin' ||
    actor.memberships.some((m) => m.role === 'approver' || m.role === 'admin')
  )
}
