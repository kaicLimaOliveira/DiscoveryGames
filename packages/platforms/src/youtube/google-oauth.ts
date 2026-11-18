import { createHash } from 'node:crypto'
import { PermanentError, TransientError } from '@central/shared'

export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly',
] as const

export interface GoogleOAuthOptions {
  clientId: string
  clientSecret: string
  redirectUri: string
  fetchFn?: typeof fetch
  /** Só para testes: substitui `https://oauth2.googleapis.com` (token e revoke). */
  oauthBaseUrl?: string
  /** Só para testes: substitui `https://www.googleapis.com` (Data API). */
  apiBaseUrl?: string
}

export interface GoogleOAuth {
  authorizeUrl(state: string, codeVerifier: string): string
  exchange(
    code: string,
    codeVerifier: string,
  ): Promise<{ refreshToken: string; accessToken: string; scopes: string[] }>
  myChannel(accessToken: string): Promise<{ channelId: string; title: string }>
  revoke(refreshToken: string): Promise<void>
}

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const OAUTH_BASE = 'https://oauth2.googleapis.com'
const API_BASE = 'https://www.googleapis.com'

export const GOOGLE_NO_OFFLINE =
  'O Google não devolveu acesso offline. Remova o acesso do app na sua conta Google e conecte de novo.'
export const GOOGLE_NO_CHANNEL = 'Esta conta Google não tem canal do YouTube.'
const GOOGLE_UNAVAILABLE = 'O Google não respondeu. Tente de novo.'
const GOOGLE_REJECTED = 'O Google recusou a autorização. Tente conectar de novo.'
const GOOGLE_REVOKE_FAILED = 'Falha ao revogar o acesso no Google.'

interface TokenBody {
  access_token?: unknown
  refresh_token?: unknown
  scope?: unknown
}

interface ChannelsBody {
  items?: Array<{ id?: unknown; snippet?: { title?: unknown } }>
}

/** Erros daqui nunca levam `cause` nem texto do Google: código, token e segredo podem vir nele. */
export function createGoogleOAuth(opts: GoogleOAuthOptions): GoogleOAuth {
  const fetchFn = opts.fetchFn ?? fetch
  const oauthBase = opts.oauthBaseUrl ?? OAUTH_BASE
  const apiBase = opts.apiBaseUrl ?? API_BASE

  async function send(url: string, init: RequestInit): Promise<Response> {
    try {
      return await fetchFn(url, init)
    } catch {
      throw new TransientError(GOOGLE_UNAVAILABLE)
    }
  }

  const form = (params: Record<string, string>): RequestInit => ({
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  })

  return {
    authorizeUrl(state, codeVerifier) {
      const url = new URL(AUTH_URL)
      url.searchParams.set('client_id', opts.clientId)
      url.searchParams.set('redirect_uri', opts.redirectUri)
      url.searchParams.set('response_type', 'code')
      url.searchParams.set('scope', GOOGLE_SCOPES.join(' '))
      url.searchParams.set('access_type', 'offline')
      url.searchParams.set('prompt', 'consent')
      url.searchParams.set('include_granted_scopes', 'true')
      url.searchParams.set('state', state)
      url.searchParams.set('code_challenge_method', 'S256')
      url.searchParams.set(
        'code_challenge',
        createHash('sha256').update(codeVerifier).digest('base64url'),
      )
      return url.toString()
    },

    async exchange(code, codeVerifier) {
      const res = await send(
        `${oauthBase}/token`,
        form({
          grant_type: 'authorization_code',
          code,
          code_verifier: codeVerifier,
          client_id: opts.clientId,
          client_secret: opts.clientSecret,
          redirect_uri: opts.redirectUri,
        }),
      )
      if (res.status >= 500 || res.status === 429) throw new TransientError(GOOGLE_UNAVAILABLE)
      if (!res.ok) throw new PermanentError(GOOGLE_REJECTED)
      const body = (await res.json().catch(() => ({}))) as TokenBody
      if (typeof body.access_token !== 'string') throw new PermanentError(GOOGLE_REJECTED)
      if (typeof body.refresh_token !== 'string' || !body.refresh_token) {
        throw new PermanentError(GOOGLE_NO_OFFLINE)
      }
      return {
        refreshToken: body.refresh_token,
        accessToken: body.access_token,
        scopes: typeof body.scope === 'string' ? body.scope.split(' ').filter(Boolean) : [],
      }
    },

    async myChannel(accessToken) {
      const url = new URL(`${apiBase}/youtube/v3/channels`)
      url.searchParams.set('part', 'snippet')
      url.searchParams.set('mine', 'true')
      const res = await send(url.toString(), {
        headers: { authorization: `Bearer ${accessToken}` },
      })
      if (res.status >= 500 || res.status === 429) throw new TransientError(GOOGLE_UNAVAILABLE)
      if (!res.ok) throw new PermanentError(GOOGLE_REJECTED)
      const body = (await res.json().catch(() => ({}))) as ChannelsBody
      const item = body.items?.[0]
      if (!item || typeof item.id !== 'string') throw new PermanentError(GOOGLE_NO_CHANNEL)
      const title = item.snippet?.title
      return { channelId: item.id, title: typeof title === 'string' && title ? title : item.id }
    },

    async revoke(refreshToken) {
      const res = await send(`${oauthBase}/revoke`, form({ token: refreshToken }))
      if (!res.ok) throw new PermanentError(GOOGLE_REVOKE_FAILED)
    },
  }
}
