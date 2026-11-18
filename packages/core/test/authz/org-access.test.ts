import type { DbOrTx } from '@central/db'
import { describe, expect, it } from 'vitest'
import type { Actor } from '../../src/authz/roles.js'
import { requireOrgAccess } from '../../src/authz/org-access.js'
import { ForbiddenError, NotFoundError } from '../../src/errors.js'

const ORG = 'org-1'
const fakeDb = (exists: boolean) =>
  ({
    organization: { findUnique: async () => (exists ? { id: ORG } : null) },
  }) as unknown as DbOrTx

const actor = (over: Partial<Actor>): Actor => ({
  userId: 'u',
  globalRole: 'member',
  memberships: [],
  ...over,
})

describe('requireOrgAccess', () => {
  it('membro com permissão passa', async () => {
    const a = actor({ memberships: [{ organizationId: ORG, role: 'admin' }] })
    await expect(requireOrgAccess(fakeDb(true), a, ORG, 'accounts.manage')).resolves.toBeUndefined()
  })

  it('quem não pertence recebe NotFoundError, sem consultar a existência', async () => {
    await expect(
      requireOrgAccess(fakeDb(true), actor({}), ORG, 'library.read'),
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('organização inexistente é NotFoundError até para admin global', async () => {
    const a = actor({ globalRole: 'admin' })
    await expect(requireOrgAccess(fakeDb(false), a, ORG, 'library.read')).rejects.toBeInstanceOf(
      NotFoundError,
    )
  })

  it('membro sem permissão recebe ForbiddenError', async () => {
    const a = actor({ memberships: [{ organizationId: ORG, role: 'viewer' }] })
    await expect(requireOrgAccess(fakeDb(true), a, ORG, 'accounts.manage')).rejects.toBeInstanceOf(
      ForbiddenError,
    )
  })
})
