import { requireActor } from '../utils/auth'
import { useWebConfig } from '../utils/config'
import { defineApiHandler } from '../utils/errors'

export default defineApiHandler(async (event) => {
  await requireActor(event)
  return { linkUploadEnabled: useWebConfig().YTDLP_ENABLED }
})
