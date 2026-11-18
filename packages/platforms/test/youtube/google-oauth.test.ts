import { createHash } from 'node:crypto'
import { PermanentError, TransientError } from '@central/shared'
import { describe, expect, it } from 'vitest'
import { createGoogleOAuth } from '../../src'

const CFG = { clientId: 'cid', clientSecret: 'csecret', redirectUri: 'https://app.test/cb' }

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function fakeFetch(responses: Array<Response | Error>) {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const fetchFn = ((input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init })
    const next = responses.shift()
    if (!next) throw new Error('sem resposta programada')
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next)
  }) as typeof fetch
  return { fetchFn, calls }
}

/** Espera a rejeição e devolve o erro. */
async function rejection(p: Promise<unknown>): Promise<Error> {
  try {
    await p
  } catch (e) {
    return e as Error
  }
  throw new Error('não rejeitou')
}

describe('createGoogleOAuth', () => {
  it('authorizeUrl inclui offline, consent, PKCE S256 e os dois escopos', () => {
    const url = new URL(createGoogleOAuth(CFG).authorizeUrl('st', 'verifier-123'))
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    const p = url.searchParams
    expect(p.get('response_type')).toBe('code')
    expect(p.get('client_id')).toBe('cid')
    expect(p.get('redirect_uri')).toBe(CFG.redirectUri)
    expect(p.get('access_type')).toBe('offline')
    expect(p.get('prompt')).toBe('consent')
    expect(p.get('include_granted_scopes')).toBe('true')
    expect(p.get('state')).toBe('st')
    expect(p.get('code_challenge_method')).toBe('S256')
    expect(p.get('code_challenge')).toBe(
      createHash('sha256').update('verifier-123').digest('base64url'),
    )
    expect(p.get('scope')?.split(' ')).toEqual([
      'https://www.googleapis.com/auth/youtube.upload',
      'https://www.googleapis.com/auth/youtube.readonly',
    ])
  })

  it('exchange devolve tokens e escopos', async () => {
    const { fetchFn, calls } = fakeFetch([
      json({ access_token: 'at', refresh_token: 'rt', scope: 'a b' }),
    ])
    const out = await createGoogleOAuth({ ...CFG, fetchFn }).exchange('code1', 'ver')
    expect(out).toEqual({ refreshToken: 'rt', accessToken: 'at', scopes: ['a', 'b'] })
    expect(calls[0]!.url).toBe('https://oauth2.googleapis.com/token')
    const body = new URLSearchParams(String(calls[0]!.init?.body))
    expect(body.get('grant_type')).toBe('authorization_code')
    expect(body.get('code_verifier')).toBe('ver')
    expect(body.get('code')).toBe('code1')
  })

  it('exchange sem refresh_token lança PermanentError', async () => {
    const { fetchFn } = fakeFetch([json({ access_token: 'at', scope: 'a' })])
    const err = await createGoogleOAuth({ ...CFG, fetchFn })
      .exchange('c', 'v')
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PermanentError)
    expect((err as Error).message).toBe(
      'O Google não devolveu acesso offline. Remova o acesso do app na sua conta Google e conecte de novo.',
    )
  })

  it('exchange: 4xx permanente, 5xx e rede transitórios, sem ecoar segredos', async () => {
    const mk = (r: Response | Error) =>
      rejection(
        createGoogleOAuth({ ...CFG, fetchFn: fakeFetch([r]).fetchFn }).exchange(
          'CODIGO_SECRETO',
          'v',
        ),
      )
    const bad = await mk(json({ error: 'invalid_grant', error_description: 'CODIGO_SECRETO' }, 400))
    expect(bad).toBeInstanceOf(PermanentError)
    expect(bad.message).not.toContain('CODIGO_SECRETO')
    expect(await mk(json({}, 503))).toBeInstanceOf(TransientError)
    const net = await mk(new Error('connect ECONNREFUSED CODIGO_SECRETO'))
    expect(net).toBeInstanceOf(TransientError)
    expect(net.message).not.toContain('CODIGO_SECRETO')
    expect(net.cause).toBeUndefined()
  })

  it('myChannel devolve id e título', async () => {
    const { fetchFn, calls } = fakeFetch([
      json({ items: [{ id: 'UC1', snippet: { title: 'Canal' } }] }),
    ])
    const out = await createGoogleOAuth({ ...CFG, fetchFn }).myChannel('at')
    expect(out).toEqual({ channelId: 'UC1', title: 'Canal' })
    const url = new URL(calls[0]!.url)
    expect(url.origin + url.pathname).toBe('https://www.googleapis.com/youtube/v3/channels')
    expect(url.searchParams.get('part')).toBe('snippet')
    expect(url.searchParams.get('mine')).toBe('true')
    expect(new Headers(calls[0]!.init?.headers).get('authorization')).toBe('Bearer at')
  })

  it('myChannel sem itens lança PermanentError', async () => {
    const { fetchFn } = fakeFetch([json({ pageInfo: { totalResults: 0 } })])
    const err = await createGoogleOAuth({ ...CFG, fetchFn })
      .myChannel('at')
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PermanentError)
    expect((err as Error).message).toBe('Esta conta Google não tem canal do YouTube.')
  })

  it('revoke envia o token no corpo e erros não o contêm', async () => {
    const ok = fakeFetch([new Response(null, { status: 200 })])
    await createGoogleOAuth({ ...CFG, fetchFn: ok.fetchFn }).revoke('RT_SECRETO')
    expect(ok.calls[0]!.url).toBe('https://oauth2.googleapis.com/revoke')
    expect(new URLSearchParams(String(ok.calls[0]!.init?.body)).get('token')).toBe('RT_SECRETO')

    for (const r of [json({ error: 'RT_SECRETO' }, 400), new Error('falhou RT_SECRETO')]) {
      const err = await rejection(
        createGoogleOAuth({ ...CFG, fetchFn: fakeFetch([r]).fetchFn }).revoke('RT_SECRETO'),
      )
      expect(err).toBeInstanceOf(Error)
      expect(err.message).not.toContain('RT_SECRETO')
      expect(err.cause).toBeUndefined()
    }
  })
})
