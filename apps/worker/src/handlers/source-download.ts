import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { Logger } from 'pino'
import type { Db, SourceStatus } from '@central/db'
import { sqlExecutorFor } from '@central/db'
import { longTimeoutMs, runTool } from '@central/media'
import { QUEUES, type JobQueue } from '@central/shared'
import type { Storage } from '@central/storage'
import { withScratch } from '../scratch.js'

export interface SourceDownloadDeps {
  db: Db
  storage: Storage
  queue: JobQueue
  /** Binário do yt-dlp (ou o interpretador, nos testes com o yt-dlp falso). */
  ytdlpPath: string
  /** Argumentos que vêm antes dos do yt-dlp (só os testes usam: `[fake-ytdlp.mjs]`). */
  ytdlpArgs?: string[]
  ffmpegPath: string
  scratchRoot: string
  maxDurationMs: number
  maxBytes: number
  logger: Logger
}

export type SourceDownloadJob = { id: string; data: { sourceId: string } }

/** Limites de entrada: 2 h e 4 GB. */
export const MAX_DOWNLOAD_BYTES = 4 * 1024 * 1024 * 1024
export const MSG = {
  rights: 'Link sem declaração de direitos não pode ser baixado.',
  tooLong: 'Vídeo acima de 2 h.',
  download: 'Não foi possível baixar pelo link. Envie o arquivo MP4.',
  conflict: 'Já existe um processamento em andamento para esta fonte.',
} as const

const STARTABLE: SourceStatus[] = ['queued', 'downloading']
const FORMAT = 'bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[ext=mp4]'

/** Fim do download com mensagem para a UI: a fonte vira `failed` e o job termina sem erro. */
class Stop extends Error {}

function errInfo(err: unknown): { name: string; message: string } {
  return err instanceof Error
    ? { name: err.name, message: err.message }
    : { name: 'unknown', message: 'erro desconhecido' }
}

export function createSourceDownloadHandler(deps: SourceDownloadDeps) {
  const { db, storage, queue, scratchRoot } = deps
  const prefix = deps.ytdlpArgs ?? []
  const ytdlp = (args: string[], timeoutMs: number) =>
    runTool(deps.ytdlpPath, [...prefix, ...args], { timeoutMs })

  return async (job: SourceDownloadJob): Promise<void> => {
    const { sourceId } = job.data
    const log = deps.logger.child({ jobId: job.id, sourceId })

    const source = await db.source.findUnique({ where: { id: sourceId } })
    if (!source || !STARTABLE.includes(source.status)) {
      log.info(
        { status: source?.status ?? null },
        'download ignorado: fonte fora de estado inicial',
      )
      return
    }
    const fail = async (detail: string) => {
      await db.source.update({
        where: { id: sourceId },
        data: { status: 'failed', statusDetail: detail },
      })
      log.info({ stage: 'failed' }, 'download encerrado')
    }

    // Defesa em profundidade: a trava de direitos também vale aqui (a fonte pode ter sido reclassificada).
    if (source.rightsBasis === 'none') return fail(MSG.rights)
    if (source.kind !== 'youtube_link' || !source.originalUrl) return fail(MSG.download)
    const url = source.originalUrl

    try {
      await withScratch(scratchRoot, job.id, (dir) => run(dir, url))
    } catch (err) {
      if (err instanceof Stop) return fail(err.message)
      // Sem retry automático: bloqueio de IP não melhora repetindo. Nunca o texto cru (stderr) na UI.
      log.warn({ err: errInfo(err) }, 'download falhou')
      return fail(MSG.download)
    }

    async function run(dir: string, link: string): Promise<void> {
      await db.source.update({ where: { id: sourceId }, data: { status: 'downloading' } })
      log.info({ stage: 'downloading' }, 'etapa do download')

      const meta = await ytdlp(['--dump-single-json', '--no-playlist', '--', link], 60_000)
      const duration = (JSON.parse(meta.stdout) as { duration?: unknown }).duration
      if (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0) {
        throw new Error('yt-dlp não informou a duração')
      }
      const durationMs = duration * 1000
      if (durationMs > deps.maxDurationMs) throw new Stop(MSG.tooLong)

      await ytdlp(
        [
          '-f',
          FORMAT,
          '--merge-output-format',
          'mp4',
          '--max-filesize',
          String(deps.maxBytes),
          '--ffmpeg-location',
          deps.ffmpegPath,
          '--no-playlist',
          '-o',
          join(dir, 'original.%(ext)s'),
          '--',
          link,
        ],
        longTimeoutMs(durationMs),
      )
      const name = (await readdir(dir)).find((f) => f.startsWith('original.') && f.endsWith('.mp4'))
      if (!name) throw new Error('yt-dlp não gerou o MP4')
      const file = join(dir, name)
      if ((await stat(file)).size > deps.maxBytes) throw new Error('arquivo acima do limite')

      const key = `orgs/${source!.organizationId}/sources/${sourceId}/original.mp4`
      await storage.uploadFile(key, file, 'video/mp4')

      // O handler de análise lê o original de `uploadKey`: grava junto com o `queued` e o envio.
      const queued = await db.$transaction(async (tx) => {
        const id = await queue.send(
          QUEUES.sourceAnalyze,
          { sourceId },
          { db: sqlExecutorFor(tx), singletonKey: sourceId },
        )
        if (id === null) return false
        await tx.source.update({
          where: { id: sourceId },
          data: { status: 'queued', statusDetail: null, uploadKey: key },
        })
        return true
      })
      if (!queued) throw new Stop(MSG.conflict)
      log.info({ stage: 'queued' }, 'download concluído; análise enfileirada')
    }
  }
}
