import { mkdir, readdir, rm, stat } from 'node:fs/promises'
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

/**
 * Idade a partir da qual uma entrada do scratch é de job morto: a expiração dos jobs longos (3 h)
 * mais folga. O `mtime` nunca é anterior à criação, então nada mais novo pode ser apagado com o
 * job ainda dentro do prazo (vale também para outro worker no mesmo volume e para as pastas
 * `_MEI*` do yt-dlp, que usa TMPDIR=/scratch).
 */
export const STALE_SCRATCH_MS = 3 * 60 * 60 * 1000 + 15 * 60 * 1000

/**
 * Apaga as entradas de `root` sem modificação há mais de `maxAgeMs` (sobras de um worker que
 * caiu: o `finally` de `withScratch` não rodou). Um job que o pg-boss repete reaproveita o mesmo
 * `<root>/<jobId>` e o limpa no fim; esta varredura pega o que nunca mais vai rodar.
 * Devolve os nomes apagados.
 */
export async function sweepStaleScratch(
  root: string,
  maxAgeMs = STALE_SCRATCH_MS,
  now = Date.now(),
): Promise<string[]> {
  let names: string[]
  try {
    names = await readdir(root)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
  const removed: string[] = []
  for (const name of names) {
    const path = join(root, name)
    const info = await stat(path).catch(() => null)
    if (!info || now - info.mtimeMs <= maxAgeMs) continue
    await rm(path, { recursive: true, force: true })
    removed.push(name)
  }
  return removed
}
