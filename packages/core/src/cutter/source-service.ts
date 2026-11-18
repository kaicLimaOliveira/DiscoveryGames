import { randomUUID } from 'node:crypto'
import {
  sqlExecutorFor,
  type CandidateStatus,
  type Db,
  type DbOrTx,
  type RightsBasis,
  type SourceKind,
  type SourceStatus,
  type Tx,
} from '@central/db'
import { QUEUES, type JobQueue } from '@central/shared'
import { MULTIPART_PART_BYTES, type Storage } from '@central/storage'
import { writeAudit } from '../audit.js'
import { requireOrgAccess } from '../authz/org-access.js'
import type { Actor } from '../authz/roles.js'
import { ConflictError, NotFoundError, ValidationError } from '../errors.js'
import {
  assertEvidenceKey,
  EVIDENCE_CONTENT_TYPES,
  validateRights,
  type PartnerAuthorization,
  type RightsInput,
} from './rights.js'

export interface SourceParams {
  targetMin: number
  targetMax: number
  minSec: number
  maxSec: number
  language: string
}

export type CandidateCounts = Record<CandidateStatus, number>

export interface SourceView {
  id: string
  title: string
  kind: SourceKind
  status: SourceStatus
  statusDetail: string | null
  rightsBasis: RightsBasis
  createdAt: Date
  candidateCounts: CandidateCounts
}

export interface RightsHistoryEntry {
  basis: RightsBasis
  creatorName: string | null
  evidenceUrl: string | null
  licenseType: string | null
  sourceUrl: string | null
  programUrl: string | null
  /** Nome de quem declarou (null se o usuário não existe mais). */
  declaredBy: string | null
  declaredAt: Date
}

export interface SourceDetail extends SourceView {
  originalUrl: string | null
  params: SourceParams
  durationMs: number | null
  /** Mais recente primeiro. */
  rightsHistory: RightsHistoryEntry[]
}

export interface CreateUploadInput {
  title: string
  fileName: string
  sizeBytes: number
  contentType: string
  rights: RightsInput
  params?: Partial<SourceParams>
}

export interface CreateFromLinkInput {
  title: string
  url: string
  rights: RightsInput
  params?: Partial<SourceParams>
}

export interface SourceService {
  createUpload(
    actor: Actor,
    orgId: string,
    input: CreateUploadInput,
  ): Promise<{ source: SourceView; uploadId: string; partSize: number; partCount: number }>
  presignEvidenceUpload(
    actor: Actor,
    orgId: string,
    contentType: string,
  ): Promise<{ key: string; url: string }>
  presignParts(
    actor: Actor,
    orgId: string,
    sourceId: string,
    partNumbers: number[],
  ): Promise<Array<{ partNumber: number; url: string }>>
  completeUpload(
    actor: Actor,
    orgId: string,
    sourceId: string,
    parts: Array<{ partNumber: number; etag: string }>,
  ): Promise<SourceView>
  abandonUpload(actor: Actor, orgId: string, sourceId: string): Promise<void>
  createFromLink(
    actor: Actor,
    orgId: string,
    input: CreateFromLinkInput,
    opts: { linkEnabled: boolean },
  ): Promise<SourceView>
  list(actor: Actor, orgId: string): Promise<SourceView[]>
  get(actor: Actor, orgId: string, sourceId: string): Promise<SourceDetail>
  changeRights(
    actor: Actor,
    orgId: string,
    sourceId: string,
    rights: RightsInput,
  ): Promise<SourceDetail>
  retry(actor: Actor, orgId: string, sourceId: string): Promise<SourceView>
}

export interface SourceLogger {
  warn(obj: Record<string, unknown>, msg: string): void
}

/** Limite de entrada do original. */
export const MAX_SOURCE_BYTES = 4 * 1024 ** 3
const MAX_PARTS_PER_CALL = 100
const MAX_TITLE = 200
const MAX_FILE_NAME = 255
const MAX_ETAG = 200

const VIDEO_EXT: Record<string, string> = {
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
  'video/webm': '.webm',
  'video/x-matroska': '.mkv',
}

const DEFAULT_CLIP = { targetMin: 5, targetMax: 10, minSec: 30, maxSec: 90 }
const RETRYABLE: SourceStatus[] = ['failed', 'blocked_budget']

// Só watch?v= (com ou sem www./m.) e youtu.be; o id tem 11 caracteres.
const YOUTUBE_RE =
  /^https:\/\/(?:(?:www\.|m\.)?youtube\.com\/watch\?v=[A-Za-z0-9_-]{11}(?:&[^\s#]*)?|youtu\.be\/[A-Za-z0-9_-]{11}(?:\?[^\s#]*)?)$/

const NOT_FOUND = 'Fonte não encontrada.'
const LINK_DISABLED = 'Envio por link desativado. Envie o arquivo MP4.'
const LINK_NONE = 'Link sem direitos não é baixado. Declare os direitos ou envie o arquivo.'
const SIZE_MISMATCH = 'O arquivo recebido não confere com o tamanho informado. Envie de novo.'
const BAD_PARTS =
  'Não foi possível concluir o envio: partes inválidas ou incompletas. Envie de novo.'

const VIEW_SELECT = {
  id: true,
  title: true,
  kind: true,
  status: true,
  statusDetail: true,
  rightsBasis: true,
  createdAt: true,
} as const

type ViewRow = Omit<SourceView, 'candidateCounts'>

function emptyCounts(): CandidateCounts {
  return { suggested: 0, accepted: 0, rejected: 0, rendered: 0 }
}

function validTitle(value: string): string {
  const title = typeof value === 'string' ? value.trim() : ''
  if (title.length === 0 || title.length > MAX_TITLE) {
    throw new ValidationError(`O título deve ter de 1 a ${MAX_TITLE} caracteres.`)
  }
  return title
}

function isInt(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n)
}

function validParams(p: SourceParams): SourceParams {
  const { targetMin, targetMax, minSec, maxSec, language } = p
  if (![targetMin, targetMax, minSec, maxSec].every(isInt)) {
    throw new ValidationError('Os parâmetros de cortes devem ser números inteiros.')
  }
  if (!(targetMin >= 1 && targetMin <= targetMax && targetMax <= 20)) {
    throw new ValidationError('Quantidade de cortes inválida: use 1 ≤ mínimo ≤ máximo ≤ 20.')
  }
  if (!(minSec >= 15 && minSec < maxSec && maxSec <= 180)) {
    throw new ValidationError('Duração dos cortes inválida: use 15 ≤ mínimo < máximo ≤ 180 s.')
  }
  let canonical: string | undefined
  try {
    canonical = typeof language === 'string' ? Intl.getCanonicalLocales(language)[0] : undefined
  } catch {
    canonical = undefined
  }
  if (!canonical || language.length > 35) throw new ValidationError('Idioma inválido.')
  return { targetMin, targetMax, minSec, maxSec, language: canonical }
}

/** Erro 4xx do S3 que não é de credencial (partes/etag inválidos, upload inexistente). */
function isClientS3Error(err: unknown): boolean {
  const status = (err as { $metadata?: { httpStatusCode?: number } } | null)?.$metadata
    ?.httpStatusCode
  return typeof status === 'number' && status >= 400 && status < 500 && status !== 403
}

export function createSourceService(deps: {
  db: Db
  storage: Storage
  queue: JobQueue
  /** Tamanho das partes do multipart; só os testes mudam (mínimo do S3: 5 MiB). */
  partBytes?: number
  logger?: SourceLogger
}): SourceService {
  const { db, storage, queue, logger } = deps
  const partBytes = deps.partBytes ?? MULTIPART_PART_BYTES

  function partCountFor(sizeBytes: number): number {
    return Math.max(1, Math.ceil(sizeBytes / partBytes))
  }

  async function load(client: DbOrTx, orgId: string, sourceId: string) {
    const row = await client.source.findFirst({ where: { id: sourceId, organizationId: orgId } })
    if (!row) throw new NotFoundError(NOT_FOUND)
    return row
  }

  async function countsFor(orgId: string, ids: string[]): Promise<Map<string, CandidateCounts>> {
    const out = new Map<string, CandidateCounts>()
    for (const id of ids) out.set(id, emptyCounts())
    if (ids.length === 0) return out
    const groups = await db.clipCandidate.groupBy({
      by: ['sourceId', 'status'],
      where: { organizationId: orgId, sourceId: { in: ids } },
      _count: { _all: true },
    })
    for (const g of groups) {
      const c = out.get(g.sourceId)
      if (c) c[g.status] = g._count._all
    }
    return out
  }

  async function viewOf(orgId: string, sourceId: string): Promise<SourceView> {
    const row: ViewRow | null = await db.source.findFirst({
      where: { id: sourceId, organizationId: orgId },
      select: VIEW_SELECT,
    })
    if (!row) throw new NotFoundError(NOT_FOUND)
    const counts = await countsFor(orgId, [row.id])
    return { ...row, candidateCounts: counts.get(row.id) ?? emptyCounts() }
  }

  async function detailOf(orgId: string, sourceId: string): Promise<SourceDetail> {
    const row = await db.source.findFirst({
      where: { id: sourceId, organizationId: orgId },
      include: {
        mediaAsset: { select: { durationMs: true } },
        rightsDeclarations: { orderBy: [{ declaredAt: 'desc' }, { id: 'desc' }] },
      },
    })
    if (!row) throw new NotFoundError(NOT_FOUND)
    const userIds = [
      ...new Set(row.rightsDeclarations.flatMap((d) => (d.declaredById ? [d.declaredById] : []))),
    ]
    const users = userIds.length
      ? await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })
      : []
    const names = new Map(users.map((u) => [u.id, u.name]))
    const counts = await countsFor(orgId, [row.id])
    return {
      id: row.id,
      title: row.title,
      kind: row.kind,
      status: row.status,
      statusDetail: row.statusDetail,
      rightsBasis: row.rightsBasis,
      createdAt: row.createdAt,
      candidateCounts: counts.get(row.id) ?? emptyCounts(),
      originalUrl: row.originalUrl,
      params: row.params as unknown as SourceParams,
      durationMs: row.mediaAsset?.durationMs ?? null,
      rightsHistory: row.rightsDeclarations.map((d) => ({
        basis: d.basis,
        creatorName: d.creatorName,
        evidenceUrl: d.evidenceUrl,
        licenseType: d.licenseType,
        sourceUrl: d.sourceUrl,
        programUrl: d.programUrl,
        declaredBy: d.declaredById ? (names.get(d.declaredById) ?? null) : null,
        declaredAt: d.declaredAt,
      })),
    }
  }

  /** Valida a declaração; parceiro e anexo são conferidos dentro da organização. */
  async function resolveRights(orgId: string, rights: RightsInput): Promise<RightsInput> {
    let partner: PartnerAuthorization | undefined
    if (rights?.basis === 'authorized' && rights.partnerCreatorId) {
      const row = await db.partnerCreator.findFirst({
        where: { id: rights.partnerCreatorId, organizationId: orgId },
        select: { name: true, authorizationUrl: true, authorizationKey: true },
      })
      if (!row) throw new NotFoundError('Criador parceiro não encontrado.')
      partner = row
    }
    const valid = validateRights(rights, partner)
    // A chave herdada do parceiro já foi conferida no cadastro dele.
    if (valid.evidenceKey && valid.evidenceKey !== partner?.authorizationKey) {
      await assertEvidenceKey(storage, orgId, valid.evidenceKey)
    }
    return valid
  }

  async function resolveParams(
    orgId: string,
    override: Partial<SourceParams> | undefined,
  ): Promise<SourceParams> {
    const org = await db.organization.findUniqueOrThrow({
      where: { id: orgId },
      select: { clipDefaults: true, locale: true },
    })
    const base = {
      ...DEFAULT_CLIP,
      ...(org.clipDefaults as Partial<SourceParams> | null),
      language: org.locale,
    }
    const merged = { ...base }
    for (const k of ['targetMin', 'targetMax', 'minSec', 'maxSec', 'language'] as const) {
      const v = override?.[k]
      if (v !== undefined) (merged as Record<string, unknown>)[k] = v
    }
    return validParams(merged)
  }

  async function writeDeclaration(
    tx: Tx,
    sourceId: string,
    rights: RightsInput,
    actor: Actor,
  ): Promise<void> {
    await tx.rightsDeclaration.create({
      data: {
        sourceId,
        basis: rights.basis,
        creatorName: rights.creatorName ?? null,
        evidenceUrl: rights.evidenceUrl ?? null,
        evidenceKey: rights.evidenceKey ?? null,
        licenseType: rights.licenseType ?? null,
        sourceUrl: rights.sourceUrl ?? null,
        programUrl: rights.programUrl ?? null,
        partnerCreatorId: rights.partnerCreatorId ?? null,
        declaredById: actor.userId,
      },
    })
  }

  return {
    async createUpload(actor, orgId, input) {
      await requireOrgAccess(db, actor, orgId, 'content.edit')
      const title = validTitle(input.title)
      const fileName = typeof input.fileName === 'string' ? input.fileName.trim() : ''
      if (fileName.length === 0 || fileName.length > MAX_FILE_NAME) {
        throw new ValidationError('Nome de arquivo inválido.')
      }
      const { sizeBytes } = input
      if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) {
        throw new ValidationError('Tamanho de arquivo inválido.')
      }
      if (sizeBytes > MAX_SOURCE_BYTES) throw new ValidationError('Arquivo acima de 4 GB.')
      const ext = VIDEO_EXT[input.contentType]
      if (!ext) throw new ValidationError('Formato não aceito. Envie MP4, MOV, WebM ou MKV.')
      const rights = await resolveRights(orgId, input.rights)
      const params = await resolveParams(orgId, input.params)

      const id = randomUUID()
      const uploadKey = `orgs/${orgId}/sources/${id}/original${ext}`
      const { uploadId } = await storage.createMultipart(uploadKey, input.contentType)
      try {
        await db.$transaction(async (tx) => {
          await tx.source.create({
            data: {
              id,
              organizationId: orgId,
              kind: 'upload',
              title,
              status: 'awaiting_upload',
              rightsBasis: rights.basis,
              partnerCreatorId: rights.partnerCreatorId ?? null,
              params: { ...params },
              uploadKey,
              uploadId,
              uploadSizeBytes: BigInt(sizeBytes),
              createdById: actor.userId,
            },
          })
          await writeDeclaration(tx, id, rights, actor)
          await writeAudit(tx, {
            action: 'source.create',
            entityType: 'source',
            entityId: id,
            userId: actor.userId,
            organizationId: orgId,
            diff: { kind: 'upload', title, fileName, sizeBytes, rights },
          })
        })
      } catch (err) {
        await storage
          .abortMultipart(uploadKey, uploadId)
          .catch((e: unknown) =>
            logger?.warn(
              { uploadKey, error: e instanceof Error ? e.message : 'erro desconhecido' },
              'falha ao abortar o multipart após erro ao criar a fonte',
            ),
          )
        throw err
      }
      return {
        source: await viewOf(orgId, id),
        uploadId,
        partSize: partBytes,
        partCount: partCountFor(sizeBytes),
      }
    },

    async presignEvidenceUpload(actor, orgId, contentType) {
      await requireOrgAccess(db, actor, orgId, 'content.edit')
      if (!EVIDENCE_CONTENT_TYPES.includes(contentType)) {
        throw new ValidationError('A evidência deve ser PNG, JPEG ou PDF.')
      }
      const key = `orgs/${orgId}/evidence/${randomUUID()}`
      // O navegador precisa enviar exatamente este Content-Type no PUT (vai na assinatura).
      return { key, url: await storage.presignPut(key, contentType) }
    },

    async presignParts(actor, orgId, sourceId, partNumbers) {
      await requireOrgAccess(db, actor, orgId, 'content.edit')
      const source = await load(db, orgId, sourceId)
      if (source.status !== 'awaiting_upload' || !source.uploadKey || !source.uploadId) {
        throw new ConflictError('O envio deste arquivo já foi concluído ou cancelado.')
      }
      const partCount = partCountFor(Number(source.uploadSizeBytes ?? 0))
      if (
        !Array.isArray(partNumbers) ||
        partNumbers.length === 0 ||
        partNumbers.length > MAX_PARTS_PER_CALL
      ) {
        throw new ValidationError(`Peça de 1 a ${MAX_PARTS_PER_CALL} partes por vez.`)
      }
      for (const n of partNumbers) {
        if (!isInt(n) || n < 1 || n > partCount) {
          throw new ValidationError(`Número de parte inválido: use de 1 a ${partCount}.`)
        }
      }
      const { uploadKey, uploadId } = source
      return Promise.all(
        partNumbers.map(async (partNumber) => ({
          partNumber,
          url: await storage.presignPart(uploadKey, uploadId, partNumber),
        })),
      )
    },

    async completeUpload(actor, orgId, sourceId, parts) {
      await requireOrgAccess(db, actor, orgId, 'content.edit')
      const source = await load(db, orgId, sourceId)
      // Idempotente: já concluída (ou falhou) devolve o estado atual sem mexer.
      if (source.status !== 'awaiting_upload') return viewOf(orgId, sourceId)
      const { uploadKey, uploadId } = source
      const declared = Number(source.uploadSizeBytes ?? 0)
      if (!uploadKey || !uploadId) throw new ConflictError('Envio sem upload em andamento.')
      const partCount = partCountFor(declared)
      if (!Array.isArray(parts) || parts.length === 0 || parts.length > partCount) {
        throw new ValidationError(BAD_PARTS)
      }
      const seen = new Set<number>()
      for (const p of parts) {
        if (
          !isInt(p?.partNumber) ||
          p.partNumber < 1 ||
          p.partNumber > partCount ||
          seen.has(p.partNumber) ||
          typeof p.etag !== 'string' ||
          p.etag.length === 0 ||
          p.etag.length > MAX_ETAG
        ) {
          throw new ValidationError(BAD_PARTS)
        }
        seen.add(p.partNumber)
      }

      try {
        await storage.completeMultipart(uploadKey, uploadId, parts)
      } catch (err) {
        if (!isClientS3Error(err)) throw err
        // Outra chamada pode ter concluído o mesmo upload em paralelo.
        const now = await load(db, orgId, sourceId)
        if (now.status !== 'awaiting_upload') return viewOf(orgId, sourceId)
        throw new ValidationError(BAD_PARTS, { cause: err })
      }

      const head = await storage.head(uploadKey)
      if (!head || head.sizeBytes !== declared || head.sizeBytes > MAX_SOURCE_BYTES) {
        await storage.abortMultipart(uploadKey, uploadId)
        if (head) await storage.delete(uploadKey)
        await db.$transaction(async (tx) => {
          await tx.source.updateMany({
            where: { id: sourceId, organizationId: orgId, status: 'awaiting_upload' },
            data: { status: 'failed', statusDetail: SIZE_MISMATCH },
          })
          await writeAudit(tx, {
            action: 'source.upload_failed',
            entityType: 'source',
            entityId: sourceId,
            userId: actor.userId,
            organizationId: orgId,
            diff: { declaredBytes: declared, receivedBytes: head?.sizeBytes ?? null },
          })
        })
        throw new ValidationError(SIZE_MISMATCH)
      }

      await db.$transaction(async (tx) => {
        const moved = await tx.source.updateMany({
          where: { id: sourceId, organizationId: orgId, status: 'awaiting_upload' },
          data: { status: 'queued', statusDetail: null },
        })
        if (moved.count === 0) return
        // Mesma transação: sem fonte em queued sem job, nem job sem fonte em queued.
        await queue.send(
          QUEUES.sourceAnalyze,
          { sourceId },
          { db: sqlExecutorFor(tx), singletonKey: sourceId },
        )
        await writeAudit(tx, {
          action: 'source.upload_complete',
          entityType: 'source',
          entityId: sourceId,
          userId: actor.userId,
          organizationId: orgId,
          diff: { sizeBytes: head.sizeBytes, parts: parts.length },
        })
      })
      return viewOf(orgId, sourceId)
    },

    async abandonUpload(actor, orgId, sourceId) {
      await requireOrgAccess(db, actor, orgId, 'content.edit')
      const source = await load(db, orgId, sourceId)
      if (source.status !== 'awaiting_upload') {
        throw new ConflictError('Só é possível cancelar um envio ainda não concluído.')
      }
      if (source.uploadKey && source.uploadId) {
        await storage.abortMultipart(source.uploadKey, source.uploadId)
      }
      await db.$transaction(async (tx) => {
        const removed = await tx.source.deleteMany({
          where: { id: sourceId, organizationId: orgId, status: 'awaiting_upload' },
        })
        if (removed.count === 0) {
          throw new ConflictError('Só é possível cancelar um envio ainda não concluído.')
        }
        await writeAudit(tx, {
          action: 'source.abandon_upload',
          entityType: 'source',
          entityId: sourceId,
          userId: actor.userId,
          organizationId: orgId,
          diff: { title: source.title },
        })
      })
    },

    async createFromLink(actor, orgId, input, opts) {
      await requireOrgAccess(db, actor, orgId, 'content.edit')
      if (!opts.linkEnabled) throw new ValidationError(LINK_DISABLED)
      // Trava de direitos: link sem direitos é recusado antes de qualquer escrita ou job.
      if (input.rights?.basis === 'none') throw new ValidationError(LINK_NONE)
      const url = typeof input.url === 'string' ? input.url.trim() : ''
      if (url.length > 2000 || !YOUTUBE_RE.test(url)) {
        throw new ValidationError(
          'Link inválido: use um endereço youtube.com/watch?v=… ou youtu.be/… (https).',
        )
      }
      const title = validTitle(input.title)
      const rights = await resolveRights(orgId, input.rights)
      const params = await resolveParams(orgId, input.params)

      const id = await db.$transaction(async (tx) => {
        const row = await tx.source.create({
          data: {
            organizationId: orgId,
            kind: 'youtube_link',
            title,
            originalUrl: url,
            status: 'queued',
            rightsBasis: rights.basis,
            partnerCreatorId: rights.partnerCreatorId ?? null,
            params: { ...params },
            createdById: actor.userId,
          },
          select: { id: true },
        })
        await writeDeclaration(tx, row.id, rights, actor)
        await writeAudit(tx, {
          action: 'source.create',
          entityType: 'source',
          entityId: row.id,
          userId: actor.userId,
          organizationId: orgId,
          diff: { kind: 'youtube_link', title, url, rights },
        })
        await queue.send(
          QUEUES.sourceDownload,
          { sourceId: row.id },
          { db: sqlExecutorFor(tx), singletonKey: row.id },
        )
        return row.id
      })
      return viewOf(orgId, id)
    },

    async list(actor, orgId) {
      await requireOrgAccess(db, actor, orgId, 'library.read')
      const rows: ViewRow[] = await db.source.findMany({
        where: { organizationId: orgId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: VIEW_SELECT,
      })
      const counts = await countsFor(
        orgId,
        rows.map((r) => r.id),
      )
      return rows.map((r) => ({ ...r, candidateCounts: counts.get(r.id) ?? emptyCounts() }))
    },

    async get(actor, orgId, sourceId) {
      await requireOrgAccess(db, actor, orgId, 'library.read')
      return detailOf(orgId, sourceId)
    },

    async changeRights(actor, orgId, sourceId, rights) {
      await requireOrgAccess(db, actor, orgId, 'publication.approve')
      const source = await load(db, orgId, sourceId)
      // Link ainda não baixado nunca fica sem direitos (o download não pode acontecer).
      if (rights?.basis === 'none' && source.kind === 'youtube_link' && !source.mediaAssetId) {
        throw new ValidationError(LINK_NONE)
      }
      const valid = await resolveRights(orgId, rights)
      await db.$transaction(async (tx) => {
        await writeDeclaration(tx, source.id, valid, actor)
        await tx.source.update({
          where: { id: source.id },
          data: { rightsBasis: valid.basis, partnerCreatorId: valid.partnerCreatorId ?? null },
        })
        // Fase 5: ao ir para `none`, bloquear aqui os agendamentos pendentes desta fonte.
        await writeAudit(tx, {
          action: 'source.rights_change',
          entityType: 'source',
          entityId: source.id,
          userId: actor.userId,
          organizationId: orgId,
          diff: { from: source.rightsBasis, to: valid.basis, declaration: valid },
        })
      })
      return detailOf(orgId, source.id)
    },

    async retry(actor, orgId, sourceId) {
      await requireOrgAccess(db, actor, orgId, 'content.edit')
      const source = await load(db, orgId, sourceId)
      if (!RETRYABLE.includes(source.status)) {
        throw new ConflictError(
          'Só é possível tentar de novo uma fonte com falha ou bloqueada pelo orçamento.',
        )
      }
      // Sem asset: link volta ao download; upload volta à análise, se o arquivo ainda existe.
      const download = !source.mediaAssetId && source.kind === 'youtube_link'
      if (download && source.rightsBasis === 'none') throw new ValidationError(LINK_NONE)
      if (!source.mediaAssetId && source.kind === 'upload') {
        if (!source.uploadKey || !(await storage.head(source.uploadKey))) {
          throw new ValidationError('O arquivo enviado não está mais disponível. Envie de novo.')
        }
      }
      await db.$transaction(async (tx) => {
        const moved = await tx.source.updateMany({
          where: { id: sourceId, organizationId: orgId, status: { in: RETRYABLE } },
          data: { status: 'queued', statusDetail: null, attempts: 0 },
        })
        if (moved.count === 0) {
          throw new ConflictError(
            'Só é possível tentar de novo uma fonte com falha ou bloqueada pelo orçamento.',
          )
        }
        await queue.send(
          download ? QUEUES.sourceDownload : QUEUES.sourceAnalyze,
          { sourceId },
          { db: sqlExecutorFor(tx), singletonKey: sourceId },
        )
        await writeAudit(tx, {
          action: 'source.retry',
          entityType: 'source',
          entityId: sourceId,
          userId: actor.userId,
          organizationId: orgId,
          diff: { from: source.status, job: download ? 'download' : 'analyze' },
        })
      })
      return viewOf(orgId, sourceId)
    },
  }
}
