import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'

/** Diretório de trabalho por job (`<root>/<jobId>`), apagado em `finally` mesmo com falha. */
export async function withScratch<T>(
  root: string,
  jobId: string,
  fn: (dir: string) => Promise<T>,
): Promise<T> {
  if (!/^[A-Za-z0-9_-]+$/.test(jobId)) throw new Error('jobId inválido para o scratch')
  const dir = join(root, jobId)
  await mkdir(dir, { recursive: true })
  try {
    return await fn(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
