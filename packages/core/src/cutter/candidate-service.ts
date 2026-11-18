import type { CandidateStatus, Db, ReframeLayout } from '@central/db'
import type { Storage } from '@central/storage'
import { writeAudit } from '../audit.js'
import { requireOrgAccess } from '../authz/org-access.js'
import type { Actor } from '../authz/roles.js'
import { ConflictError, NotFoundError, ValidationError } from '../errors.js'

export type { ReframeLayout } from '@central/db'

export interface CandidateView {
  id: string
  rank: number
  startMs: number
  endMs: number
  suggestedStartMs: number
  suggestedEndMs: number
  hookScore: number
  reason: string
  title: string
  captions: unknown
  hashtags: string[]
  layout: ReframeLayout
  status: CandidateStatus
  decidedAt: Date | null
}

export interface AdjustInput {
  startMs: number
  endMs: number
  layout?: ReframeLayout
  title?: string
}

export interface CandidateService {
  list(actor: Actor, orgId: string, sourceId: string): Promise<CandidateView[]>
  decide(
    actor: Actor,
    orgId: string,
    candidateId: string,
    decision: 'accept' | 'reject',
  ): Promise<CandidateView>
  adjust(
    actor: Actor,
    orgId: string,
    candidateId: string,
    input: AdjustInput,
  ): Promise<CandidateView>
  playerUrl(
    actor: Actor,
    orgId: string,
    sourceId: string,
  ): Promise<{ url: string; expiresAt: Date }>
}

/** Mínimo do Facebook Reels (spec §3) e teto dos Shorts. */
export const MIN_CLIP_MS = 3_000
export const MAX_CLIP_MS = 180_000
const PLAYER_URL_SEC = 3600
const MAX_TITLE = 200

const NOT_FOUND = 'Candidato não encontrado.'
const SOURCE_NOT_FOUND = 'Fonte não encontrada.'
const VIDEO_NOT_FOUND = 'Vídeo da fonte não encontrado.'
const RENDERED = 'Este corte já foi renderizado e não pode mais ser alterado.'

const LAYOUTS: readonly string[] = ['face', 'center', 'game_facecam', 'blur_fit']
const OPEN: CandidateStatus[] = ['suggested', 'accepted', 'rejected']

const VIEW_SELECT = {
  id: true,
  rank: true,
  startMs: true,
  endMs: true,
  suggestedStartMs: true,
  suggestedEndMs: true,
  hookScore: true,
  reason: true,
  title: true,
  captions: true,
  hashtags: true,
  layout: true,
  status: true,
  decidedAt: true,
} as const

export function createCandidateService(deps: { db: Db; storage: Storage }): CandidateService {
  const { db, storage } = deps

  async function loadCandidate(orgId: string, candidateId: string) {
    const row = await db.clipCandidate.findFirst({
      where: { id: candidateId, organizationId: orgId },
    })
    if (!row) throw new NotFoundError(NOT_FOUND)
    return row
  }

  async function viewOf(orgId: string, candidateId: string): Promise<CandidateView> {
    const row = await db.clipCandidate.findFirst({
      where: { id: candidateId, organizationId: orgId },
      select: VIEW_SELECT,
    })
    if (!row) throw new NotFoundError(NOT_FOUND)
    return row
  }

  async function assetOf(orgId: string, sourceId: string) {
    const source = await db.source.findFirst({
      where: { id: sourceId, organizationId: orgId },
      select: { mediaAsset: { select: { durationMs: true, storageKey: true } } },
    })
    if (!source) throw new NotFoundError(SOURCE_NOT_FOUND)
    if (!source.mediaAsset) throw new NotFoundError(VIDEO_NOT_FOUND)
    return source.mediaAsset
  }

  return {
    async list(actor, orgId, sourceId) {
      await requireOrgAccess(db, actor, orgId, 'library.read')
      const source = await db.source.findFirst({
        where: { id: sourceId, organizationId: orgId },
        select: { id: true },
      })
      if (!source) throw new NotFoundError(SOURCE_NOT_FOUND)
      return db.clipCandidate.findMany({
        where: { organizationId: orgId, sourceId },
        orderBy: [{ rank: 'asc' }, { id: 'asc' }],
        select: VIEW_SELECT,
      })
    },

    async decide(actor, orgId, candidateId, decision) {
      await requireOrgAccess(db, actor, orgId, 'content.edit')
      if (decision !== 'accept' && decision !== 'reject') {
        throw new ValidationError('Decisão inválida.')
      }
      const target: CandidateStatus = decision === 'accept' ? 'accepted' : 'rejected'
      const row = await loadCandidate(orgId, candidateId)
      if (!OPEN.includes(row.status)) throw new ConflictError(RENDERED)
      // Repetir a mesma decisão é idempotente: não muda nada e não gera nova auditoria.
      if (row.status === target) return viewOf(orgId, candidateId)
      await db.$transaction(async (tx) => {
        // O filtro de status fecha a corrida com a renderização (Fase 4).
        const moved = await tx.clipCandidate.updateMany({
          where: { id: candidateId, organizationId: orgId, status: { in: OPEN } },
          data: { status: target, decidedById: actor.userId, decidedAt: new Date() },
        })
        if (moved.count === 0) throw new ConflictError(RENDERED)
        await writeAudit(tx, {
          action: `candidate.${decision}`,
          entityType: 'clip_candidate',
          entityId: candidateId,
          userId: actor.userId,
          organizationId: orgId,
          diff: { from: row.status, to: target },
        })
      })
      // Fase 4: ao aceitar, enfileirar a renderização do corte aqui.
      return viewOf(orgId, candidateId)
    },

    async adjust(actor, orgId, candidateId, input) {
      await requireOrgAccess(db, actor, orgId, 'content.edit')
      const row = await loadCandidate(orgId, candidateId)
      const { startMs, endMs } = input
      if (!Number.isInteger(startMs) || !Number.isInteger(endMs)) {
        throw new ValidationError('Início e fim devem ser números inteiros em milissegundos.')
      }
      let layout: ReframeLayout | undefined
      if (input.layout !== undefined) {
        if (!LAYOUTS.includes(input.layout)) throw new ValidationError('Layout inválido.')
        layout = input.layout
      }
      let title: string | undefined
      if (input.title !== undefined) {
        title = typeof input.title === 'string' ? input.title.trim() : ''
        if (title.length === 0 || title.length > MAX_TITLE) {
          throw new ValidationError(`O título deve ter de 1 a ${MAX_TITLE} caracteres.`)
        }
      }
      const asset = await assetOf(orgId, row.sourceId)
      if (startMs < 0 || endMs <= startMs || endMs > asset.durationMs) {
        throw new ValidationError(
          'Início e fim devem estar dentro do vídeo, com o fim após o início.',
        )
      }
      const length = endMs - startMs
      if (length < MIN_CLIP_MS || length > MAX_CLIP_MS) {
        throw new ValidationError('O corte deve durar entre 3 e 180 segundos.')
      }
      if (row.status === 'rendered') throw new ConflictError(RENDERED)

      const before = {
        startMs: row.startMs,
        endMs: row.endMs,
        layout: row.layout,
        title: row.title,
      }
      const after = {
        startMs,
        endMs,
        layout: layout ?? row.layout,
        title: title ?? row.title,
      }
      // Só os campos que mudaram vão para o diff da auditoria.
      const keys = (Object.keys(after) as Array<keyof typeof after>).filter(
        (k) => after[k] !== before[k],
      )
      if (keys.length === 0) return viewOf(orgId, candidateId)
      const diff = {
        before: Object.fromEntries(keys.map((k) => [k, before[k]])),
        after: Object.fromEntries(keys.map((k) => [k, after[k]])),
      }
      await db.$transaction(async (tx) => {
        const moved = await tx.clipCandidate.updateMany({
          where: { id: candidateId, organizationId: orgId, status: { in: OPEN } },
          data: after,
        })
        if (moved.count === 0) throw new ConflictError(RENDERED)
        await writeAudit(tx, {
          action: 'candidate.adjust',
          entityType: 'clip_candidate',
          entityId: candidateId,
          userId: actor.userId,
          organizationId: orgId,
          diff,
        })
      })
      return viewOf(orgId, candidateId)
    },

    async playerUrl(actor, orgId, sourceId) {
      await requireOrgAccess(db, actor, orgId, 'library.read')
      const asset = await assetOf(orgId, sourceId)
      const url = await storage.presignGet(asset.storageKey, {
        inline: true,
        expiresSec: PLAYER_URL_SEC,
      })
      return { url, expiresAt: new Date(Date.now() + PLAYER_URL_SEC * 1000) }
    },
  }
}
