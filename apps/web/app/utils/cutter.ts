export type SourceStatus =
  | 'awaiting_upload'
  | 'queued'
  | 'downloading'
  | 'probing'
  | 'transcribing'
  | 'analyzing'
  | 'ready'
  | 'failed'
  | 'blocked_budget'

export type RightsBasis = 'own' | 'authorized' | 'cc_license' | 'clipper_program' | 'none'
export type Layout = 'face' | 'center' | 'game_facecam' | 'blur_fit'

export interface SourceView {
  id: string
  title: string
  kind: 'upload' | 'youtube_link'
  status: SourceStatus
  statusDetail: string | null
  rightsBasis: RightsBasis
  createdAt: string
  candidateCounts: Record<'suggested' | 'accepted' | 'rejected' | 'rendered', number>
}

export interface RightsHistoryEntry {
  basis: RightsBasis
  creatorName: string | null
  evidenceUrl: string | null
  licenseType: string | null
  sourceUrl: string | null
  programUrl: string | null
  declaredBy: string | null
  declaredAt: string
}

export interface SourceDetail extends SourceView {
  originalUrl: string | null
  params: { targetMin: number; targetMax: number; minSec: number; maxSec: number; language: string }
  durationMs: number | null
  rightsHistory: RightsHistoryEntry[]
}

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
  captions: {
    instagram?: { caption?: string }
    facebook?: { caption?: string }
    tiktok?: { caption?: string }
    youtube?: { title?: string; description?: string }
  } | null
  hashtags: string[]
  layout: Layout
  status: 'suggested' | 'accepted' | 'rejected' | 'rendered'
  decidedAt: string | null
}

export interface PartnerCreator {
  id: string
  name: string
  channels: string[]
  authorizationUrl: string | null
  authorizationKey: string | null
  notes: string
}

export interface RightsValue {
  basis: RightsBasis
  accepted: boolean
  creatorName: string
  partnerCreatorId: string
  evidenceUrl: string
  evidenceKey: string
  evidenceName: string
  licenseType: string
  sourceUrl: string
  programUrl: string
}

export const SOURCE_STATUS_LABELS: Record<SourceStatus, string> = {
  awaiting_upload: 'Enviando',
  queued: 'Na fila',
  downloading: 'Baixando',
  probing: 'Lendo o vídeo',
  transcribing: 'Transcrevendo',
  analyzing: 'Escolhendo trechos',
  ready: 'Pronto',
  failed: 'Falhou',
  blocked_budget: 'Bloqueado: orçamento',
}

const IN_PROGRESS: SourceStatus[] = [
  'awaiting_upload',
  'queued',
  'downloading',
  'probing',
  'transcribing',
  'analyzing',
]

/** Processando: a lista atualiza sozinha enquanto houver uma fonte assim. */
export function isProcessing(status: SourceStatus): boolean {
  return IN_PROGRESS.includes(status)
}

export const RIGHTS_LABELS: Record<RightsBasis, string> = {
  own: 'Conteúdo próprio',
  authorized: 'Autorizado por criador',
  cc_license: 'Licença Creative Commons',
  clipper_program: 'Programa de cortes',
  none: 'Sem direitos (só estudo)',
}

export const RIGHTS_HELP: Record<RightsBasis, string> = {
  own: 'O vídeo é seu ou da sua organização.',
  authorized: 'Um criador deu permissão para usar o vídeo; informe o nome e a prova.',
  cc_license: 'O vídeo tem licença Creative Commons que permite o uso; informe a fonte.',
  clipper_program: 'O criador abriu um programa de cortes com regras públicas; informe o link.',
  none: 'Sem permissão de uso: gera sugestões só para estudo.',
}

export const LAYOUT_LABELS: Record<Layout, string> = {
  face: 'Rosto',
  center: 'Centro',
  game_facecam: 'Jogo + facecam',
  blur_fit: 'Vídeo inteiro com fundo desfocado',
}

export function emptyRights(): RightsValue {
  return {
    basis: 'own',
    accepted: false,
    creatorName: '',
    partnerCreatorId: '',
    evidenceUrl: '',
    evidenceKey: '',
    evidenceName: '',
    licenseType: '',
    sourceUrl: '',
    programUrl: '',
  }
}

export const OWN_ACCEPT_ERROR = 'Confirme que você é dono do vídeo para declarar direitos próprios.'

/** Checagem de tela; as regras de verdade são do servidor. */
export function rightsError(r: RightsValue): string {
  if (r.basis === 'own' && !r.accepted) return OWN_ACCEPT_ERROR
  return ''
}

/** Só os campos que valem para a categoria, no formato da API. */
export function rightsPayload(r: RightsValue): Record<string, unknown> {
  const opt = (v: string) => (v.trim() ? v.trim() : undefined)
  switch (r.basis) {
    case 'own':
      return { basis: 'own', accepted: r.accepted }
    case 'authorized':
      return {
        basis: 'authorized',
        creatorName: opt(r.creatorName),
        partnerCreatorId: opt(r.partnerCreatorId),
        evidenceUrl: opt(r.evidenceUrl),
        evidenceKey: opt(r.evidenceKey),
      }
    case 'cc_license':
      return {
        basis: 'cc_license',
        sourceUrl: opt(r.sourceUrl),
        licenseType: opt(r.licenseType),
      }
    case 'clipper_program':
      return { basis: 'clipper_program', programUrl: opt(r.programUrl) }
    case 'none':
      return { basis: 'none' }
  }
}

/** `m:ss.d` (décimos de segundo). */
export function formatMs(ms: number): string {
  const tenths = Math.round(ms / 100)
  const m = Math.floor(tenths / 600)
  const s = Math.floor((tenths % 600) / 10)
  return `${m}:${String(s).padStart(2, '0')}.${tenths % 10}`
}

/** Aceita `mm:ss.d`, `mm:ss` e segundos puros (`75.5`); devolve ms ou null se inválido. */
export function parseMs(text: string): number | null {
  const t = text.trim().replace(',', '.')
  const m = /^(?:(\d+):)?(\d+)(?:\.(\d{1,3}))?$/.exec(t)
  if (!m) return null
  const minutes = m[1] ? Number(m[1]) : 0
  const seconds = Number(m[2])
  if (m[1] && seconds >= 60) return null
  const frac = m[3] ? Number(m[3].padEnd(3, '0')) : 0
  return (minutes * 60 + seconds) * 1000 + frac
}

type ApiOpts = { method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; body?: unknown }

// $fetch com rota dinâmica estoura a profundidade de tipos das rotas do Nitro; URL tipada como string.
export const api = $fetch as <T = unknown>(url: string, opts?: ApiOpts) => Promise<T>

export function serverApi(): <T = unknown>(url: string, opts?: ApiOpts) => Promise<T> {
  return useRequestFetch() as unknown as <T = unknown>(url: string, opts?: ApiOpts) => Promise<T>
}
