import type { DbOrTx } from '@central/db'
import type { Actor } from './roles.js'

export async function loadActor(
  db: DbOrTx,
  userId: string,
): Promise<(Actor & { sessionVersion: number }) | null> {
  const user = await db.user.findUnique({
    where: { id: userId },
    include: { memberships: { select: { organizationId: true, role: true } } },
  })
  if (!user || user.status === 'disabled') return null
  return {
    userId: user.id,
    globalRole: user.role,
    memberships: user.memberships.map((m) => ({ organizationId: m.organizationId, role: m.role })),
    sessionVersion: user.sessionVersion,
  }
}
