import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Logger } from 'pino'
import {
  estimateAnalysisCostUsd,
  LlmError,
  SELECT_CLIPS_PROMPT,
  selectClips,
  selectClipsInputHash,
  TranscriberError,
  transcriptionCostUsd,
  type CandidateOut,
  type LlmProvider,
  type SelectClipsInput,
  type Transcriber,
} from '@central/ai'
import { checkBudget, recordCost } from '@central/core'
import type { Db, SourceStatus } from '@central/db'
import {
  analyzeSignals,
  extractAudioChunks,
  frameTimes,
  MediaToolError,
  probe,
  sampleFrames,
  sha256File,
  type Signals,
} from '@central/media'
import type { Storage } from '@central/storage'
import { withScratch } from '../scratch.js'

export interface SourceAnalyzeDeps {
  db: Db
  storage: Storage
  transcriber: Transcriber | null
  llm: LlmProvider | null
  model: string
  scratchRoot: string
  /** Limite de duração do original (padrão 2 h; só os testes mudam). */
  maxDurationMs?: number
  logger: Logger
}

export type SourceAnalyzeJob = { id: string; data: { sourceId: string } }

/** Limite de entrada: vídeo de até 2 h. */
export const MAX_DURATION_MS = 2 * 60 * 60 * 1000
/** Execuções do job com erro transitório antes de desistir (igual ao retryLimit 2 do pg-boss + 1). */
export const MAX_ATTEMPTS = 3
const AUDIO_CHUNK_SEC = 600
const TASK = 'select_clips'

const RESUMABLE: SourceStatus[] = ['queued', 'probing', 'transcribing', 'analyzing']

export const MSG = {
  notConfigured: 'Integração de IA não configurada.',
  tooLong: 'Vídeo acima de 2 h.',
  noVideo: 'Arquivo sem faixa de vídeo.',
  missingOriginal: 'O arquivo enviado não está mais disponível. Envie de novo.',
  budget: 'Orçamento de IA do mês esgotado. Aumente o orçamento ou aguarde o próximo mês.',
  noCandidates: 'A IA não encontrou trechos válidos. Tente de novo ou ajuste a faixa de duração.',
  decode: 'Não foi possível ler o vídeo. Verifique o arquivo e envie de novo.',
  transcription: 'A transcrição falhou. Tente de novo.',
  llm: 'A análise da IA falhou. Tente de novo.',
  transient: 'Falha temporária repetida. Tente de novo.',
} as const

/** Fim da análise com mensagem para a UI: a fonte vai para `status` e o job termina sem erro. */
class Stop extends Error {
  constructor(
    message: string,
    readonly status: 'failed' | 'blocked_budget' = 'failed',
  ) {
    super(message)
    this.name = 'Stop'
  }
}

interface SourceParams {
  targetMin: number
  targetMax: number
  minSec: number
  maxSec: number
  language: string
}

/** Erros que não melhoram repetindo: viram `failed` com mensagem fixa (nunca o texto cru). */
function fatalMessage(err: unknown): string | null {
  if (err instanceof MediaToolError && err.code === 'EXIT') return MSG.decode
  if (err instanceof TranscriberError && !err.retryable) return MSG.transcription
  if (err instanceof LlmError && !err.retryable) return MSG.llm
  return null
}

/** Só nome e mensagem: nada de payload, transcrição ou cabeçalhos. */
function errInfo(err: unknown): { name: string; message: string } {
  return err instanceof Error
    ? { name: err.name, message: err.message }
    : { name: 'unknown', message: 'erro desconhecido' }
}

/** Valor para coluna Json (o namespace `Prisma` não é exportado por @central/db). */
const json = (v: unknown) => v as never

/** Durações dos blocos de áudio (o último é o resto da duração). */
function chunkDurationsSec(chunks: Array<{ offsetMs: number }>, durationMs: number): number[] {
  return chunks.map((c) => Math.max(0, Math.min(AUDIO_CHUNK_SEC, (durationMs - c.offsetMs) / 1000)))
}

export function createSourceAnalyzeHandler(deps: SourceAnalyzeDeps) {
  const { db, storage, transcriber, llm, model, scratchRoot } = deps
  const maxDurationMs = deps.maxDurationMs ?? MAX_DURATION_MS

  return async (job: SourceAnalyzeJob): Promise<void> => {
    const { sourceId } = job.data
    const log = deps.logger.child({ jobId: job.id, sourceId })

    const source = await db.source.findUnique({ where: { id: sourceId } })
    if (!source || !RESUMABLE.includes(source.status)) {
      log.info(
        { status: source?.status ?? null },
        'análise ignorada: fonte fora de estado retomável',
      )
      return
    }

    // `queued` = início de análise (nova ou retry do usuário); outro estado = retomada pelo pg-boss.
    const startedFromQueued = source.status === 'queued'
    const setStatus = async (status: SourceStatus) => {
      await db.source.update({ where: { id: sourceId }, data: { status } })
      log.info({ stage: status }, 'etapa da análise')
    }
    const stop = async (status: 'failed' | 'blocked_budget', detail: string) => {
      await db.source.update({ where: { id: sourceId }, data: { status, statusDetail: detail } })
      log.info({ stage: status }, 'análise encerrada')
    }

    if (!transcriber || !llm) return stop('failed', MSG.notConfigured)

    try {
      await withScratch(scratchRoot, job.id, (dir) => run(dir))
    } catch (err) {
      if (err instanceof Stop) return stop(err.status, err.message)
      const fatal = fatalMessage(err)
      if (fatal) {
        log.warn({ err: errInfo(err) }, 'análise falhou')
        return stop('failed', fatal)
      }
      // Transitório (rede, I/O, timeout, 429/5xx): conta a tentativa e devolve ao pg-boss.
      const { attempts } = await db.source.update({
        where: { id: sourceId },
        data: { attempts: { increment: 1 } },
        select: { attempts: true },
      })
      log.warn({ err: errInfo(err), attempts }, 'falha transitória na análise')
      if (attempts >= MAX_ATTEMPTS) return stop('failed', MSG.transient)
      throw err
    }
    log.info({ stage: 'ready' }, 'análise concluída')

    async function run(dir: string): Promise<void> {
      const params = source!.params as unknown as SourceParams
      const organizationId = source!.organizationId

      // 1. probing: baixa o original e, na primeira vez, cria o MediaAsset.
      await setStatus('probing')
      const key = source!.uploadKey
      if (!key || !(await storage.head(key))) throw new Stop(MSG.missingOriginal)
      const file = join(dir, 'original')
      await storage.downloadToFile(key, file)

      let asset = source!.mediaAssetId
        ? await db.mediaAsset.findUnique({ where: { id: source!.mediaAssetId } })
        : null
      if (!asset) {
        const info = await probe(file)
        if (!info.video) throw new Stop(MSG.noVideo)
        if (info.durationMs > maxDurationMs) throw new Stop(MSG.tooLong)
        const sha256 = await sha256File(file)
        const head = await storage.head(key)
        asset = await db.$transaction(async (tx) => {
          const created = await tx.mediaAsset.create({
            data: {
              organizationId,
              kind: 'original',
              storageKey: key,
              sha256,
              sizeBytes: BigInt(info.sizeBytes),
              mimeType: head?.contentType ?? 'video/mp4',
              probe: json(info),
              durationMs: info.durationMs,
              width: info.video?.width ?? null,
              height: info.video?.height ?? null,
              hasAudio: info.audio !== null,
            },
          })
          await tx.source.update({ where: { id: sourceId }, data: { mediaAssetId: created.id } })
          return created
        })
      } else if (asset.durationMs > maxDurationMs) {
        throw new Stop(MSG.tooLong)
      }
      const durationMs = asset.durationMs

      // 2. Orçamento (spec §5.3): toda análise que começa de `queued` (nova ou "Tentar de novo")
      // é uma nova análise e passa pelo saldo; a retomada pelo pg-boss de uma etapa em andamento
      // só passa se ainda não houve gasto nesta fonte (análise em andamento termina).
      const [existingTranscript, okRun] = await Promise.all([
        db.transcript.findUnique({ where: { sourceId } }),
        db.aiRun.findFirst({ where: { sourceId, task: TASK, status: 'ok' }, select: { id: true } }),
      ])
      if (startedFromQueued || (!existingTranscript && !okRun)) {
        // A transcrição só entra se ainda não existe; a chamada do Claude entra sempre (o cache
        // por inputHash só é conhecido depois dos quadros, que vêm depois desta checagem).
        const full = estimateAnalysisCostUsd(durationMs, frameTimes(durationMs).length)
        const estimate = existingTranscript
          ? full - transcriptionCostUsd([durationMs / 1000])
          : full
        const budget = await checkBudget(db, organizationId, estimate)
        if (!budget.allowed) throw new Stop(MSG.budget, 'blocked_budget')
      }

      // 3. transcribing: reaproveita a transcrição de uma execução anterior.
      await setStatus('transcribing')
      let transcript = existingTranscript
      if (!transcript) {
        if (!asset.hasAudio) {
          // Sem áudio: transcrição vazia é sinal, não erro; não chama o Groq.
          transcript = await db.transcript.create({
            data: {
              sourceId,
              language: params.language,
              text: '',
              words: [],
              provider: 'none',
              model: 'none',
              durationSec: Math.round(durationMs / 1000),
              costUsd: 0,
            },
          })
        } else {
          const chunks = await extractAudioChunks(
            file,
            join(dir, 'audio'),
            durationMs,
            AUDIO_CHUNK_SEC,
          )
          const result = await transcriber!.transcribe(chunks, params.language)
          const durations = chunkDurationsSec(chunks, durationMs)
          const costUsd = transcriptionCostUsd(durations)
          transcript = await db.$transaction(async (tx) => {
            const row = await tx.transcript.create({
              data: {
                sourceId,
                language: result.language,
                text: result.text,
                words: json(result.words),
                provider: transcriber!.provider,
                model: transcriber!.model,
                durationSec: Math.round(result.durationSec),
                costUsd,
              },
            })
            await recordCost(
              tx,
              {
                organizationId,
                category: 'transcription',
                provider: transcriber!.provider,
                units: durations.reduce((a, b) => a + b, 0),
                unitType: 'seconds',
                costUsd,
                refType: 'Transcript',
                refId: sourceId,
              },
              { logger: log },
            )
            return row
          })
        }
      }

      // 4. Sinais (reaproveitados se já calculados) e quadros (nunca persistidos).
      await setStatus('analyzing')
      let signals = source!.signals as unknown as Signals | null
      if (!signals) {
        signals = await analyzeSignals(file, durationMs)
        await db.source.update({
          where: { id: sourceId },
          data: { signals: json(signals) },
        })
      }
      const frames = await sampleFrames(file, durationMs, join(dir, 'frames'))
      const org = await db.organization.findUniqueOrThrow({
        where: { id: organizationId },
        select: { name: true, tags: true, voiceGuide: true },
      })
      const input: SelectClipsInput = {
        durationMs,
        language: params.language,
        params: {
          targetMin: params.targetMin,
          targetMax: params.targetMax,
          minSec: params.minSec,
          maxSec: params.maxSec,
        },
        org,
        transcript: {
          text: transcript.text,
          words: transcript.words as unknown as SelectClipsInput['transcript']['words'],
        },
        signals,
        frames: await Promise.all(
          frames.map(async (f) => ({
            atSec: f.atSec,
            base64: (await readFile(f.path)).toString('base64'),
          })),
        ),
      }

      // 5. IA: cache por inputHash + versão do prompt + modelo (docs/09 §4).
      const inputHash = selectClipsInputHash(input, model)
      const cached = await db.aiRun.findFirst({
        where: {
          organizationId,
          task: TASK,
          inputHash,
          promptVersion: SELECT_CLIPS_PROMPT.version,
          model,
          status: 'ok',
        },
        orderBy: { createdAt: 'desc' },
        select: { id: true, output: true },
      })

      let candidates: CandidateOut[]
      let aiRunId: string
      if (cached && Array.isArray(cached.output) && cached.output.length > 0) {
        log.info({ aiRunId: cached.id }, 'cache de AiRun reaproveitado')
        candidates = cached.output as unknown as CandidateOut[]
        aiRunId = cached.id
      } else {
        // Guarda o último LlmError: selectClips o converte em run `error` sem dizer se é retryable.
        let lastLlmError: LlmError | undefined
        const tracked: LlmProvider = {
          provider: llm!.provider,
          async generateStructured(req) {
            try {
              return await llm!.generateStructured(req)
            } catch (err) {
              if (err instanceof LlmError) lastLlmError = err
              throw err
            }
          },
        }
        const result = await selectClips(tracked, input, { model })
        // Um AiRun por tentativa, cada um com seu lançamento de custo (mesmo os que falharam).
        const runIds = await db.$transaction(async (tx) => {
          const ids: string[] = []
          for (const r of result.runs) {
            const ok = r.status === 'ok'
            const row = await tx.aiRun.create({
              data: {
                organizationId,
                sourceId,
                task: TASK,
                provider: llm!.provider,
                model,
                promptId: SELECT_CLIPS_PROMPT.id,
                promptVersion: SELECT_CLIPS_PROMPT.version,
                inputHash: result.inputHash,
                // ok: os candidatos já validados (reaproveitados no cache); senão, a saída crua.
                output: json(ok ? result.candidates : r.output),
                status: r.status,
                error: r.error ?? null,
                inputTokens: r.usage.inputTokens,
                outputTokens: r.usage.outputTokens,
                cacheReadTokens: r.usage.cacheReadTokens,
                cacheWriteTokens: r.usage.cacheWriteTokens,
                costUsd: r.costUsd,
                latencyMs: Math.round(r.latencyMs),
              },
              select: { id: true },
            })
            await recordCost(
              tx,
              {
                organizationId,
                category: 'llm',
                provider: llm!.provider,
                units: r.costUsd,
                unitType: 'usd',
                costUsd: r.costUsd,
                refType: 'AiRun',
                refId: row.id,
              },
              { logger: log },
            )
            ids.push(row.id)
          }
          return ids
        })
        const last = result.runs.at(-1)
        if (result.candidates.length === 0) {
          // Erro de chamada (sem resposta): transitório volta ao pg-boss; definitivo vira failed.
          if (last?.status === 'error' && lastLlmError) throw lastLlmError
          throw new Stop(MSG.noCandidates)
        }
        candidates = result.candidates
        aiRunId = runIds.at(-1)!
      }

      // 6. Candidatos: troca os `suggested` desta fonte e marca `ready` na mesma transação. Os
      // aceitos/rejeitados ficam; os novos sugeridos são numerados depois do maior rank restante.
      await db.$transaction(async (tx) => {
        await tx.clipCandidate.deleteMany({ where: { sourceId, status: 'suggested' } })
        const kept = await tx.clipCandidate.aggregate({ where: { sourceId }, _max: { rank: true } })
        const baseRank = kept._max.rank ?? 0
        await tx.clipCandidate.createMany({
          data: candidates.map((c, i) => {
            const startMs = Math.round(c.startSec * 1000)
            const endMs = Math.round(c.endSec * 1000)
            return {
              organizationId,
              sourceId,
              aiRunId,
              rank: baseRank + i + 1,
              startMs,
              endMs,
              suggestedStartMs: startMs,
              suggestedEndMs: endMs,
              hookScore: Math.round(c.hookScore),
              reason: c.reason,
              title: c.title,
              captions: c.captions,
              hashtags: c.hashtags,
              layout: c.layout,
            }
          }),
        })
        await tx.source.update({
          where: { id: sourceId },
          data: { status: 'ready', statusDetail: null },
        })
      })
    }
  }
}
