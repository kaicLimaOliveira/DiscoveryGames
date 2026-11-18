import { describe, expect, it } from 'vitest'
import { can, requires2fa, type Action, type Actor } from '../../src/authz/roles.js'

const B1 = 'org-1'
const B2 = 'org-2'

type Role = 'viewer' | 'editor' | 'approver' | 'admin'

// Matriz de docs/13-seguranca.md §3 (literal, independente de ACTION_MIN_ROLE).
const MATRIX: Record<Action, Record<Role, boolean>> = {
  'library.read': { viewer: true, editor: true, approver: true, admin: true },
  'content.edit': { viewer: false, editor: true, approver: true, admin: true },
  'publication.approve': { viewer: false, editor: false, approver: true, admin: true },
  'publishing.pause': { viewer: false, editor: false, approver: true, admin: true },
  'accounts.manage': { viewer: false, editor: false, approver: false, admin: true },
  'settings.manage': { viewer: false, editor: false, approver: false, admin: true },
  'users.manage': { viewer: false, editor: false, approver: false, admin: true },
  'organizations.create': { viewer: false, editor: false, approver: false, admin: true },
}

const cases = (Object.keys(MATRIX) as Action[]).flatMap((action) =>
  (Object.keys(MATRIX[action]) as Role[]).map(
    (role) => [action, role, MATRIX[action][role]] as const,
  ),
)

const member = (role: Role): Actor => ({
  userId: 'u',
  globalRole: 'member',
  memberships: [{ organizationId: B1, role }],
})
const globalAdmin: Actor = { userId: 'a', globalRole: 'admin', memberships: [] }

describe('can', () => {
  it.each(cases)('%s com papel %s => %s', (action, role, expected) => {
    expect(can(member(role), B1, action)).toBe(expected)
  })

  it('membro de uma organização não age em outra organização', () => {
    expect(can(member('admin'), B2, 'library.read')).toBe(false)
  })

  it('organizationId null só vale para admin global', () => {
    expect(can(member('admin'), null, 'library.read')).toBe(false)
    expect(can(globalAdmin, null, 'users.manage')).toBe(true)
  })

  it('admin global pode tudo em qualquer organização', () => {
    for (const action of Object.keys(MATRIX) as Action[]) {
      expect(can(globalAdmin, B2, action)).toBe(true)
    }
  })

  it('sem memberships não pode nada', () => {
    expect(can({ userId: 'x', globalRole: 'member', memberships: [] }, B1, 'library.read')).toBe(
      false,
    )
  })
})

describe('requires2fa', () => {
  it('admin global exige', () => expect(requires2fa(globalAdmin)).toBe(true))
  it('approver e admin de organização exigem', () => {
    expect(requires2fa(member('approver'))).toBe(true)
    expect(requires2fa(member('admin'))).toBe(true)
  })
  it('editor/viewer não exigem', () => {
    expect(requires2fa(member('editor'))).toBe(false)
    expect(requires2fa(member('viewer'))).toBe(false)
    expect(requires2fa({ userId: 'x', globalRole: 'member', memberships: [] })).toBe(false)
  })
})
