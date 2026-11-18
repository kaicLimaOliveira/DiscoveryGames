import { createHmac } from 'node:crypto'
import { PermanentError, TransientError } from '@central/shared'

export interface MetaPage {
  pageId: string
  pageName: string
  pageAccessToken: string
  instagram: { id: string; username: string } | null
}

export interface MetaGraphClient {
  /** `GET /me/accounts` (docs/07-integracoes/facebook.md [F11]), seguindo `paging.next`. */
  discoverPages(token: string): Promise<MetaPage[]>
}

export interface MetaGraphClientOptions {
  appSecret: string
  /** Formato `v21.0`. */
  graphVersion: string
  fetchFn?: typeof fetch
  /** Só para testes; produção usa o host oficial da Meta. */
  baseUrl?: string
}

export const META_GRAPH_BASE_URL = 'https://graph.facebook.com'
const MAX_PAGES = 10
const FIELDS = 'id,name,access_token,instagram_business_account{id,username}'

export const META_INVALID_TOKEN = 'Token da Meta inválido ou expirado.'
export const META_NO_PAGES =
  'Nenhuma Página encontrada para este token. Confira se a Página foi atribuída ao System User.'
const META_UNAVAILABLE = 'A Meta não respondeu. Tente de novo.'
const META_REJECTED = 'A Meta recusou a requisição. Confira as permissões do token.'

interface RawPage {
  id?: unknown
  name?: unknown
  access_token?: unknown
  instagram_business_account?: { id?: unknown; username?: unknown } | null
}

interface RawResponse {
  data?: RawPage[]
  paging?: { next?: string }
  error?: { code?: number; type?: string }
}

/** Origem da URL; malformada vira erro fixo (o TypeError do `URL` pode ecoar a URL com o token). */
function originOf(url: string): string {
  try {
    return new URL(url).origin
  } catch {
    throw new TransientError(META_UNAVAILABLE)
  }
}

export function metaAppSecretProof(token: string, appSecret: string): string {
  return createHmac('sha256', appSecret).update(token).digest('hex')
}

export function createMetaGraphClient(opts: MetaGraphClientOptions): MetaGraphClient {
  const fetchFn = opts.fetchFn ?? fetch
  const baseUrl = opts.baseUrl ?? META_GRAPH_BASE_URL
  const origin = new URL(baseUrl).origin

  async function getJson(url: string): Promise<RawResponse> {
    let res: Response
    try {
      res = await fetchFn(url)
    } catch {
      // Sem `cause`: o erro de rede pode carregar a URL (com o token).
      throw new TransientError(META_UNAVAILABLE)
    }
    const body = (await res.json().catch(() => ({}))) as RawResponse
    if (res.ok) return body
    if (res.status >= 500 || res.status === 429) throw new TransientError(META_UNAVAILABLE)
    // Só o código 190 é token inválido/expirado; outras OAuthException (permissão, app) são recusa.
    if (body.error?.code === 190) throw new PermanentError(META_INVALID_TOKEN)
    throw new PermanentError(META_REJECTED)
  }

  return {
    async discoverPages(token) {
      const first = new URL(`${baseUrl}/${opts.graphVersion}/me/accounts`)
      first.searchParams.set('fields', FIELDS)
      first.searchParams.set('access_token', token)
      first.searchParams.set('appsecret_proof', metaAppSecretProof(token, opts.appSecret))

      const pages: MetaPage[] = []
      let url: string | undefined = first.toString()
      for (let i = 0; url && i < MAX_PAGES; i++) {
        const body = await getJson(url)
        for (const raw of body.data ?? []) {
          if (
            typeof raw.id !== 'string' ||
            typeof raw.name !== 'string' ||
            typeof raw.access_token !== 'string'
          ) {
            continue
          }
          const ig = raw.instagram_business_account
          pages.push({
            pageId: raw.id,
            pageName: raw.name,
            pageAccessToken: raw.access_token,
            instagram:
              ig && typeof ig.id === 'string' && typeof ig.username === 'string'
                ? { id: ig.id, username: ig.username }
                : null,
          })
        }
        url = body.paging?.next
        // O token vai na URL de `paging.next`: nunca seguir para outro host.
        if (url && originOf(url) !== origin) throw new TransientError(META_UNAVAILABLE)
      }
      if (pages.length === 0) throw new PermanentError(META_NO_PAGES)
      return pages
    },
  }
}
