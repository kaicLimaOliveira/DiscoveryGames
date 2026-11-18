export type SqlExecutor = {
  executeSql(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>
}

export const QUEUES = {
  systemEcho: 'system.echo',
  sourceAnalyze: 'source.analyze',
  sourceDownload: 'source.download',
  /** Fila de mortos de `source.analyze` e `source.download` (job que esgotou os retries). */
  sourceDeadLetter: 'source.dead_letter',
} as const
export type QueueName = (typeof QUEUES)[keyof typeof QUEUES]

export interface SendOptions {
  db?: SqlExecutor
  /** Dedupes only on queues with a keyed policy (e.g. `exclusive`); ignored by `standard` queues. */
  singletonKey?: string
  startAfter?: Date
}

export interface JobQueue {
  send(name: QueueName, data: object, opts?: SendOptions): Promise<string | null>
}
