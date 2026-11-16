import type { DbOrTx } from '@central/db'

export async function writeAudit(
  db: DbOrTx,
  e: {
    action: string
    entityType: string
    entityId?: string
    userId?: string
    brandId?: string
    diff?: unknown
    ip?: string
  },
): Promise<void> {
  await db.auditLog.create({
    data: {
      action: e.action,
      entityType: e.entityType,
      entityId: e.entityId,
      userId: e.userId,
      brandId: e.brandId,
      // JSON arbitrário; undefined vira NULL no banco.
      diff: e.diff === undefined ? undefined : (e.diff as never),
      ip: e.ip,
    },
  })
}
