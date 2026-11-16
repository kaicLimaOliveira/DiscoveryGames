// Healthcheck do container: o heartbeat do worker é recente (prova que o schema pgboss foi
// instalado e o processo está vivo). Sai com 0 se saudável, 1 caso contrário.
import { createPrisma, readHeartbeat } from '@central/db'

const MAX_AGE_MS = 90_000

async function main(): Promise<boolean> {
  const url = process.env.DATABASE_URL
  if (!url) return false
  const db = createPrisma(url)
  try {
    const rows = await db.$queryRaw<
      { ok: boolean }[]
    >`SELECT to_regclass('pgboss.job') IS NOT NULL AS ok`
    if (!rows[0]?.ok) return false
    const at = await readHeartbeat(db, 'worker')
    return at !== null && Date.now() - at.getTime() <= MAX_AGE_MS
  } finally {
    await db.$disconnect()
  }
}

main().then(
  (ok) => process.exit(ok ? 0 : 1),
  () => process.exit(1),
)
