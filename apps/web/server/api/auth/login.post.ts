import { z } from 'zod'
import { clientIp, writeSession } from '../../utils/auth'
import { defineApiHandler, readValidated } from '../../utils/errors'
import { useServices } from '../../utils/services'

const Body = z.object({
  email: z.string().min(1).max(320),
  password: z.string().min(1).max(1024),
})

export default defineApiHandler(async (event) => {
  const { email, password } = await readValidated(event, Body)
  const { db, identity } = useServices()
  const result = await identity.login({ email, password, ip: clientIp(event) })
  const user = await db.user.findUniqueOrThrow({
    where: { id: result.userId },
    select: { id: true, name: true, email: true },
  })
  await writeSession(event, {
    user: { ...user, stage: result.stage },
    secure: { sessionVersion: result.sessionVersion, lastSeenAt: Date.now() },
  })
  return { stage: result.stage }
})
