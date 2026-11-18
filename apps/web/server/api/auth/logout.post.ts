import { defineApiHandler } from '../../utils/errors'

export default defineApiHandler(async (event) => {
  await clearUserSession(event)
  return { ok: true }
})
