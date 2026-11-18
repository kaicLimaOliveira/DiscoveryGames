import type { Db } from '@central/db'
import type { Storage } from '@central/storage'
import { writeAudit } from '../audit.js'
import { requireOrgAccess } from '../authz/org-access.js'
import type { Actor } from '../authz/roles.js'
import { NotFoundError, ValidationError } from '../errors.js'
import { assertEvidenceKey, httpsUrl } from './rights.js'

export interface PartnerCreatorView {
  id: string
  name: string
  channels: string[]
  authorizationUrl: string | null
  authorizationKey: string | null
  notes: string
  createdAt: Date
}

export interface PartnerCreatorInput {
  name: string
  channels: string[]
  authorizationUrl?: string | null
  /** Chave devolvida por `SourceService.presignEvidenceUpload`. */
  authorizationKey?: string | null
  notes?: string
}

export type PartnerCreatorPatch = Partial<PartnerCreatorInput>

export interface PartnerCreatorService {
  list(actor: Actor, orgId: string): Promise<PartnerCreatorView[]>
  create(actor: Actor, orgId: string, input: PartnerCreatorInput): Promise<PartnerCreatorView>
  update(
    actor: Actor,
    orgId: string,
    id: string,
    patch: PartnerCreatorPatch,
  ): Promise<PartnerCreatorView>
  remove(actor: Actor, orgId: string, id: string): Promise<void>
}

const MAX_NAME = 200
const MAX_CHANNELS = 30
const MAX_CHANNEL = 300
const MAX_NOTES = 5000
const NOT_FOUND = 'Criador parceiro não encontrado.'

const VIEW_SELECT = {
  id: true,
  name: true,
  channels: true,
  authorizationUrl: true,
  authorizationKey: true,
  notes: true,
  createdAt: true,
} as const

type Normalized = {
  name?: string
  channels?: string[]
  authorizationUrl?: string | null
  authorizationKey?: string | null
  notes?: string
}

export function createPartnerCreatorService(deps: {
  db: Db
  storage: Storage
}): PartnerCreatorService {
  const { db, storage } = deps

  /** Valida o que veio e devolve só os campos informados (null limpa os opcionais). */
  async function normalize(orgId: string, input: PartnerCreatorPatch): Promise<Normalized> {
    const out: Normalized = {}
    if (input.name !== undefined) {
      const name = typeof input.name === 'string' ? input.name.trim() : ''
      if (name.length === 0 || name.length > MAX_NAME) {
        throw new ValidationError(`O nome deve ter de 1 a ${MAX_NAME} caracteres.`)
      }
      out.name = name
    }
    if (input.channels !== undefined) {
      if (!Array.isArray(input.channels)) throw new ValidationError('Canais inválidos.')
      const channels: string[] = []
      for (const raw of input.channels) {
        const c = typeof raw === 'string' ? raw.trim() : ''
        if (c.length === 0) continue
        if (c.length > MAX_CHANNEL) {
          throw new ValidationError(`Cada canal deve ter até ${MAX_CHANNEL} caracteres.`)
        }
        if (!channels.includes(c)) channels.push(c)
      }
      if (channels.length > MAX_CHANNELS) {
        throw new ValidationError(`No máximo ${MAX_CHANNELS} canais.`)
      }
      out.channels = channels
    }
    if (input.authorizationUrl !== undefined) {
      out.authorizationUrl = httpsUrl(input.authorizationUrl, 'Link da autorização') ?? null
    }
    if (input.authorizationKey !== undefined) {
      const key = input.authorizationKey?.trim() || null
      if (key) await assertEvidenceKey(storage, orgId, key)
      out.authorizationKey = key
    }
    if (input.notes !== undefined) {
      if (typeof input.notes !== 'string' || input.notes.length > MAX_NOTES) {
        throw new ValidationError(`As observações devem ter até ${MAX_NOTES} caracteres.`)
      }
      out.notes = input.notes
    }
    return out
  }

  async function load(orgId: string, id: string) {
    const row = await db.partnerCreator.findFirst({
      where: { id, organizationId: orgId },
      select: VIEW_SELECT,
    })
    if (!row) throw new NotFoundError(NOT_FOUND)
    return row
  }

  return {
    async list(actor, orgId) {
      // Leitura liberada: quem declara `authorized` escolhe o parceiro na lista.
      await requireOrgAccess(db, actor, orgId, 'library.read')
      return db.partnerCreator.findMany({
        where: { organizationId: orgId },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        select: VIEW_SELECT,
      })
    },

    async create(actor, orgId, input) {
      await requireOrgAccess(db, actor, orgId, 'settings.manage')
      const data = await normalize(orgId, { ...input, channels: input.channels ?? [] })
      if (data.name === undefined) throw new ValidationError('Informe o nome do criador.')
      const { name, channels = [], ...rest } = data
      return db.$transaction(async (tx) => {
        const row = await tx.partnerCreator.create({
          data: { organizationId: orgId, name, channels, ...rest },
          select: VIEW_SELECT,
        })
        await writeAudit(tx, {
          action: 'partner_creator.create',
          entityType: 'partner_creator',
          entityId: row.id,
          userId: actor.userId,
          organizationId: orgId,
          diff: { name, channels, ...rest },
        })
        return row
      })
    },

    async update(actor, orgId, id, patch) {
      await requireOrgAccess(db, actor, orgId, 'settings.manage')
      const before = await load(orgId, id)
      const data = await normalize(orgId, patch)
      return db.$transaction(async (tx) => {
        const row = await tx.partnerCreator.update({
          where: { id: before.id },
          data,
          select: VIEW_SELECT,
        })
        const diff: Record<string, { from: unknown; to: unknown }> = {}
        for (const k of Object.keys(data) as Array<keyof Normalized>) {
          diff[k] = { from: before[k], to: row[k] }
        }
        await writeAudit(tx, {
          action: 'partner_creator.update',
          entityType: 'partner_creator',
          entityId: row.id,
          userId: actor.userId,
          organizationId: orgId,
          diff,
        })
        return row
      })
    },

    async remove(actor, orgId, id) {
      await requireOrgAccess(db, actor, orgId, 'settings.manage')
      const row = await load(orgId, id)
      // O anexo de autorização fica no storage: declarações antigas podem apontar para ele.
      await db.$transaction(async (tx) => {
        await tx.partnerCreator.delete({ where: { id: row.id } })
        await writeAudit(tx, {
          action: 'partner_creator.remove',
          entityType: 'partner_creator',
          entityId: row.id,
          userId: actor.userId,
          organizationId: orgId,
          diff: { name: row.name },
        })
      })
    },
  }
}
