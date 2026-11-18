import type { Logger } from 'pino'
import { withContext } from '@central/shared'

export function createEchoHandler(logger: Logger) {
  return async (job: { id: string; data: unknown }): Promise<void> => {
    withContext(logger, { jobId: job.id }).info({ jobId: job.id, data: job.data }, 'echo')
  }
}
