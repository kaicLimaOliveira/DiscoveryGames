import type { DbOrTx } from './client.js'

export async function recordHeartbeat(
  db: DbOrTx,
  name: string,
  at: Date = new Date(),
): Promise<void> {
  await db.heartbeat.upsert({
    where: { name },
    create: { name, at },
    update: { at },
  })
}

export async function readHeartbeat(db: DbOrTx, name: string): Promise<Date | null> {
  const row = await db.heartbeat.findUnique({ where: { name } })
  return row?.at ?? null
}
