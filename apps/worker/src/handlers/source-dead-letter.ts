import type { Logger } from 'pino'
import type { Db, PgBossQueue, SourceStatus } from '@central/db'
import { QUEUES } from '@central/shared'
import { MSG } from './source-analyze.js'

export interface SourceDeadLetterDeps {
  db: Db
  queue: Pick<PgBossQueue, 'hasPendingJob'>
  logger: Logger
}

export type SourceDeadLetterJob = { id: string; data: { sourceId: string } }

/** Estados em que a fonte espera um job de análise ou download. */
const IN_PROGRESS: SourceStatus[] = [
  'queued',
  'downloading',
  'probing',
  'transcribing',
  'analyzing',
]

/**
 * Fila de mortos de `source.analyze` e `source.download`: o pg-boss manda para cá o job que
 * esgotou os retries (inclusive por expiração, heartbeat perdido ou queda do worker, que não
 * passam pelo contador `attempts` do handler). Sem isto a fonte ficaria em andamento para
 * sempre e o `retry()` recusaria. Marca `failed` com a mensagem transitória, se a fonte ainda
 * estiver em andamento e nenhum outro job da mesma fonte estiver na fila ou rodando.
 */
export function createSourceDeadLetterHandler(deps: SourceDeadLetterDeps) {
  const { db, queue } = deps
  return async (job: SourceDeadLetterJob): Promise<void> => {
    const { sourceId } = job.data
    const log = deps.logger.child({ jobId: job.id, sourceId })
    if (await queue.hasPendingJob([QUEUES.sourceAnalyze, QUEUES.sourceDownload], sourceId)) {
      log.info('job morto ignorado: a fonte tem outro job pendente')
      return
    }
    const { count } = await db.source.updateMany({
      where: { id: sourceId, status: { in: IN_PROGRESS } },
      data: { status: 'failed', statusDetail: MSG.transient },
    })
    log.warn({ stage: count ? 'failed' : null }, 'job da fonte esgotou as tentativas')
  }
}
