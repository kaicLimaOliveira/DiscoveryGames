export type SqlExecutor = {
  executeSql(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>
}

export const QUEUES = { systemEcho: 'system.echo' } as const
export type QueueName = (typeof QUEUES)[keyof typeof QUEUES]

export interface SendOptions {
  db?: SqlExecutor
  singletonKey?: string
  startAfter?: Date
}

export interface JobQueue {
  send(name: QueueName, data: object, opts?: SendOptions): Promise<string | null>
}
