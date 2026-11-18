import type { Db } from '@central/db'
import { writeAudit } from '../audit.js'
import { can, type Actor } from '../authz/roles.js'
import { isUniqueViolation } from '../auth/identity-service.js'
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../errors.js'

export interface ClipDefaults {
  targetMin: number
  targetMax: number
  minSec: number
  maxSec: number
}

export interface OrganizationSummary {
  id: string
  name: string
  slug: string
}

export interface OrganizationDetail extends OrganizationSummary {
  timezone: string
  locale: string
  tags: string[]
  voiceGuide: string
  fixedHashtags: string[]
  creditTemplate: string
  captionStyle: Record<string, unknown>
  clipDefaults: ClipDefaults
  retention: { sourceDays: number; unusedSourceDays: number; clipDays: number }
  aiMonthlyBudgetUsd: number
  active: boolean
}

export interface OrganizationSettingsPatch {
  name?: string
  timezone?: string
  locale?: string
  tags?: string[]
  voiceGuide?: string
  fixedHashtags?: string[]
  creditTemplate?: string
  captionStyle?: Record<string, unknown>
  clipDefaults?: ClipDefaults
  aiMonthlyBudgetUsd?: number
}

export interface CreateOrganizationInput {
  name: string
  slug?: string
  timezone?: string
  locale?: string
}

export interface OrganizationService {
  list(actor: Actor): Promise<OrganizationSummary[]>
  get(actor: Actor, id: string): Promise<OrganizationDetail>
  create(actor: Actor, input: CreateOrganizationInput): Promise<OrganizationDetail>
  update(actor: Actor, id: string, patch: OrganizationSettingsPatch): Promise<OrganizationDetail>
}

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/
const MAX_NAME = 200
const MAX_SLUG = 60
const MAX_LIST = 30
const MAX_TAG = 50
const MAX_TEXT = 5000
const MAX_BUDGET = 10_000

const TIMEZONES = new Set<string>(Intl.supportedValuesOf('timeZone').concat('UTC'))

/** Minúsculas, sem acento, não alfanuméricos viram hífen. */
export function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function validName(value: string): string {
  const name = value.trim()
  if (name.length === 0 || name.length > MAX_NAME) {
    throw new ValidationError(`O nome deve ter de 1 a ${MAX_NAME} caracteres.`)
  }
  return name
}

function validTimezone(value: string): string {
  if (!TIMEZONES.has(value)) throw new ValidationError('Fuso horário inválido.')
  return value
}

function validLocale(value: string): string {
  try {
    const [canonical] = Intl.getCanonicalLocales(value)
    if (canonical && value.length <= 35) return canonical
  } catch {
    // cai no erro abaixo
  }
  throw new ValidationError('Idioma inválido.')
}

function normalizeTags(label: string, values: string[]): string[] {
  const out: string[] = []
  for (const raw of values) {
    const tag = raw.trim().replace(/^#+/, '').trim().toLowerCase()
    if (tag.length === 0) continue
    if (tag.length > MAX_TAG) {
      throw new ValidationError(`Cada item de ${label} deve ter até ${MAX_TAG} caracteres.`)
    }
    if (!out.includes(tag)) out.push(tag)
  }
  if (out.length > MAX_LIST) {
    throw new ValidationError(`${label} aceita no máximo ${MAX_LIST} itens.`)
  }
  return out
}

function isInt(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n)
}

function validClipDefaults(c: ClipDefaults): ClipDefaults {
  const { targetMin, targetMax, minSec, maxSec } = c
  if (![targetMin, targetMax, minSec, maxSec].every(isInt)) {
    throw new ValidationError('Os padrões de cortes devem ser números inteiros.')
  }
  if (!(targetMin >= 1 && targetMin <= targetMax && targetMax <= 20)) {
    throw new ValidationError('Quantidade de cortes inválida: use 1 ≤ mínimo ≤ máximo ≤ 20.')
  }
  if (!(minSec >= 15 && minSec < maxSec && maxSec <= 180)) {
    throw new ValidationError('Duração dos cortes inválida: use 15 ≤ mínimo < máximo ≤ 180 s.')
  }
  return { targetMin, targetMax, minSec, maxSec }
}

function validText(label: string, value: string, min = 0): string {
  if (typeof value !== 'string' || value.length < min || value.length > MAX_TEXT) {
    throw new ValidationError(`${label} inválido.`)
  }
  return value
}

function validBudget(n: number): number {
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > MAX_BUDGET) {
    throw new ValidationError(`O orçamento mensal de IA deve ficar entre 0 e ${MAX_BUDGET}.`)
  }
  return Math.round(n * 100) / 100
}

function validObject(label: string, value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ValidationError(`${label} inválido.`)
  }
  return value as Record<string, unknown>
}

/** Valida e normaliza o patch; só devolve os campos informados. */
function normalizePatch(patch: OrganizationSettingsPatch): OrganizationSettingsPatch {
  const out: OrganizationSettingsPatch = {}
  if (patch.name !== undefined) out.name = validName(patch.name)
  if (patch.timezone !== undefined) out.timezone = validTimezone(patch.timezone)
  if (patch.locale !== undefined) out.locale = validLocale(patch.locale)
  if (patch.tags !== undefined) out.tags = normalizeTags('Tags', patch.tags)
  if (patch.fixedHashtags !== undefined) {
    out.fixedHashtags = normalizeTags('Hashtags fixas', patch.fixedHashtags)
  }
  if (patch.voiceGuide !== undefined) out.voiceGuide = validText('Guia de voz', patch.voiceGuide)
  if (patch.creditTemplate !== undefined) {
    out.creditTemplate = validText('Modelo de crédito', patch.creditTemplate, 1)
  }
  if (patch.captionStyle !== undefined) {
    out.captionStyle = validObject('Estilo de legenda', patch.captionStyle)
  }
  if (patch.clipDefaults !== undefined) out.clipDefaults = validClipDefaults(patch.clipDefaults)
  if (patch.aiMonthlyBudgetUsd !== undefined) {
    out.aiMonthlyBudgetUsd = validBudget(patch.aiMonthlyBudgetUsd)
  }
  return out
}

interface Row {
  id: string
  name: string
  slug: string
  timezone: string
  locale: string
  tags: string[]
  voiceGuide: string
  fixedHashtags: string[]
  creditTemplate: string
  captionStyle: unknown
  clipDefaults: unknown
  retention: unknown
  aiMonthlyBudgetUsd: { toNumber(): number }
  active: boolean
}

function toDetail(r: Row): OrganizationDetail {
  return {
    id: r.id,
    name: r.name,
    slug: r.slug,
    timezone: r.timezone,
    locale: r.locale,
    tags: r.tags,
    voiceGuide: r.voiceGuide,
    fixedHashtags: r.fixedHashtags,
    creditTemplate: r.creditTemplate,
    captionStyle: r.captionStyle as Record<string, unknown>,
    clipDefaults: r.clipDefaults as ClipDefaults,
    retention: r.retention as OrganizationDetail['retention'],
    aiMonthlyBudgetUsd: r.aiMonthlyBudgetUsd.toNumber(),
    active: r.active,
  }
}

const NOT_FOUND = 'Organização não encontrada.'

export function createOrganizationService(deps: { db: Db; now?: () => Date }): OrganizationService {
  const { db } = deps

  async function load(actor: Actor, id: string, action: 'library.read' | 'settings.manage') {
    // Não revela a existência: quem não pertence à organização recebe 404, nunca 403.
    const visible =
      actor.globalRole === 'admin' || actor.memberships.some((m) => m.organizationId === id)
    const row = visible ? await db.organization.findUnique({ where: { id } }) : null
    if (!row) throw new NotFoundError(NOT_FOUND)
    if (!can(actor, id, action)) throw new ForbiddenError()
    return row
  }

  return {
    async list(actor) {
      const where =
        actor.globalRole === 'admin'
          ? {}
          : { id: { in: actor.memberships.map((m) => m.organizationId) } }
      return db.organization.findMany({
        where,
        orderBy: { name: 'asc' },
        select: { id: true, name: true, slug: true },
      })
    },

    async get(actor, id) {
      return toDetail(await load(actor, id, 'library.read'))
    },

    async create(actor, input) {
      if (!can(actor, null, 'organizations.create')) throw new ForbiddenError()
      const name = validName(input.name)
      const slug = input.slug ?? slugify(name)
      if (slug.length === 0 || slug.length > MAX_SLUG || !SLUG_RE.test(slug)) {
        throw new ValidationError(
          'Identificador inválido: use letras minúsculas, números e hífens.',
        )
      }
      const timezone = input.timezone === undefined ? undefined : validTimezone(input.timezone)
      const locale = input.locale === undefined ? undefined : validLocale(input.locale)
      try {
        return await db.$transaction(async (tx) => {
          const row = await tx.organization.create({ data: { name, slug, timezone, locale } })
          await writeAudit(tx, {
            action: 'organization.created',
            entityType: 'organization',
            entityId: row.id,
            userId: actor.userId,
            organizationId: row.id,
            diff: { name, slug, timezone: row.timezone, locale: row.locale },
          })
          return toDetail(row)
        })
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new ConflictError('Já existe uma organização com este identificador.')
        }
        throw err
      }
    },

    async update(actor, id, patch) {
      await load(actor, id, 'settings.manage')
      const changes = normalizePatch(patch)
      return db.$transaction(async (tx) => {
        const before = await tx.organization.findUnique({ where: { id } })
        if (!before) throw new NotFoundError(NOT_FOUND)
        const prev = toDetail(before) as unknown as Record<string, unknown>
        const diff: Record<string, { from: unknown; to: unknown }> = {}
        for (const [key, to] of Object.entries(changes)) {
          if (JSON.stringify(prev[key]) !== JSON.stringify(to)) diff[key] = { from: prev[key], to }
        }
        if (Object.keys(diff).length === 0) return toDetail(before)
        const row = await tx.organization.update({
          where: { id },
          data: changes as never,
        })
        await writeAudit(tx, {
          action: 'organization.updated',
          entityType: 'organization',
          entityId: id,
          userId: actor.userId,
          organizationId: id,
          diff,
        })
        return toDetail(row)
      })
    },
  }
}
