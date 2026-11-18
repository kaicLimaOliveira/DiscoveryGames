import type { DbOrTx, RightsBasis } from '@central/db'
import type { Storage } from '@central/storage'
import { ForbiddenError, NotFoundError, ValidationError } from '../errors.js'

export interface RightsInput {
  basis: RightsBasis
  accepted?: boolean
  creatorName?: string
  evidenceUrl?: string
  evidenceKey?: string
  licenseType?: string
  sourceUrl?: string
  programUrl?: string
  partnerCreatorId?: string
}

export interface PartnerAuthorization {
  name: string
  authorizationUrl: string | null
  authorizationKey: string | null
}

const BASES: readonly RightsBasis[] = ['own', 'authorized', 'cc_license', 'clipper_program', 'none']
const MAX_URL = 2000
const MAX_TEXT = 200

/** Tamanho máximo de um anexo de evidência ou autorização. */
export const EVIDENCE_MAX_BYTES = 10 * 1024 * 1024
export const EVIDENCE_CONTENT_TYPES: readonly string[] = [
  'image/png',
  'image/jpeg',
  'application/pdf',
]

function text(value: string | undefined, label: string): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') throw new ValidationError(`${label} inválido.`)
  const v = value.trim()
  if (v.length === 0) return undefined
  if (v.length > MAX_TEXT) {
    throw new ValidationError(`${label} deve ter até ${MAX_TEXT} caracteres.`)
  }
  return v
}

/** Só aceita URLs `https:` (nada de http, javascript, data...). */
export function httpsUrl(value: string | undefined | null, label: string): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') throw new ValidationError(`${label} inválido.`)
  const v = value.trim()
  if (v.length === 0) return undefined
  let url: URL
  try {
    url = new URL(v)
  } catch {
    throw new ValidationError(`${label} deve ser um endereço https:// válido.`)
  }
  if (url.protocol !== 'https:' || v.length > MAX_URL) {
    throw new ValidationError(`${label} deve ser um endereço https:// válido.`)
  }
  return v
}

/**
 * Valida a declaração de direitos e devolve só os campos que valem para a categoria.
 * Função pura: conferir a existência de `evidenceKey` no storage é de quem chama
 * (`assertEvidenceKey`), assim como carregar o parceiro na organização certa.
 */
export function validateRights(input: RightsInput, partner?: PartnerAuthorization): RightsInput {
  if (!input || !BASES.includes(input.basis)) {
    throw new ValidationError('Categoria de direitos inválida.')
  }
  switch (input.basis) {
    case 'none':
      return { basis: 'none' }

    case 'own':
      if (input.accepted !== true) {
        throw new ValidationError(
          'Confirme que você é dono do vídeo para declarar direitos próprios.',
        )
      }
      return { basis: 'own', accepted: true }

    case 'authorized': {
      let creatorName = text(input.creatorName, 'Nome do criador')
      let evidenceUrl = httpsUrl(input.evidenceUrl, 'Link da evidência')
      let evidenceKey = text(input.evidenceKey, 'Anexo da evidência')
      const partnerCreatorId = input.partnerCreatorId
      if (partnerCreatorId && partner) {
        creatorName ??= partner.name
        // Parceiro com autorização registrada serve de evidência.
        if (!evidenceUrl && !evidenceKey) {
          evidenceUrl = partner.authorizationUrl ?? undefined
          evidenceKey = partner.authorizationKey ?? undefined
        }
      }
      if (!creatorName) throw new ValidationError('Informe o nome do criador que autorizou.')
      if (!evidenceUrl && !evidenceKey) {
        throw new ValidationError('Anexe a autorização ou informe o link dela.')
      }
      return {
        basis: 'authorized',
        ...(partnerCreatorId && partner ? { partnerCreatorId } : {}),
        creatorName,
        ...(evidenceUrl ? { evidenceUrl } : {}),
        ...(evidenceKey ? { evidenceKey } : {}),
      }
    }

    case 'cc_license': {
      const sourceUrl = httpsUrl(input.sourceUrl, 'Link da fonte')
      const licenseType = text(input.licenseType, 'Tipo de licença')
      if (!sourceUrl) throw new ValidationError('Informe o link da fonte com a licença.')
      if (!licenseType) throw new ValidationError('Informe o tipo de licença (ex.: CC BY 4.0).')
      return { basis: 'cc_license', sourceUrl, licenseType }
    }

    case 'clipper_program': {
      const programUrl = httpsUrl(input.programUrl, 'Link do programa')
      if (!programUrl) throw new ValidationError('Informe o link do programa ou das regras.')
      return { basis: 'clipper_program', programUrl }
    }
  }
}

/**
 * Confere um anexo enviado por `presignEvidenceUpload`: chave da própria organização,
 * objeto existente, até 10 MiB e de um tipo aceito.
 */
export async function assertEvidenceKey(
  storage: Storage,
  orgId: string,
  key: string,
): Promise<void> {
  const prefix = `orgs/${orgId}/evidence/`
  const rest = key.startsWith(prefix) ? key.slice(prefix.length) : ''
  if (!/^[A-Za-z0-9-]+$/.test(rest)) throw new ValidationError('Anexo de evidência inválido.')
  const head = await storage.head(key)
  if (!head) throw new ValidationError('Anexo de evidência não encontrado. Envie de novo.')
  if (head.sizeBytes > EVIDENCE_MAX_BYTES) {
    throw new ValidationError('O anexo de evidência deve ter até 10 MB.')
  }
  if (head.contentType && !EVIDENCE_CONTENT_TYPES.includes(head.contentType)) {
    throw new ValidationError('O anexo de evidência deve ser PNG, JPEG ou PDF.')
  }
}

/** Trava de direitos: as Fases 4 e 5 chamam isto antes de publicar, agendar e baixar. */
export async function assertPublishable(db: DbOrTx, sourceId: string): Promise<void> {
  const source = await db.source.findUnique({
    where: { id: sourceId },
    select: { rightsBasis: true },
  })
  if (!source) throw new NotFoundError('Fonte não encontrada.')
  if (source.rightsBasis === 'none') throw new ForbiddenError('Fonte sem direitos de publicação.')
}
