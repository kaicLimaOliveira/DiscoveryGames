import { createHmac } from 'node:crypto'
import { PermanentError, TransientError } from '@central/shared'
import { describe, expect, it } from 'vitest'
import { createMetaGraphClient } from '../../src'

const SECRET = 'segredo-do-app'
const TOKEN = 'EAAtoken123'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function fakeFetch(responses: Response[]) {
  const urls: string[] = []
  const fetchFn = ((input: string | URL | Request) => {
    urls.push(String(input))
    const next = responses.shift()
    if (!next) throw new Error('sem resposta programada')
    return Promise.resolve(next)
  }) as typeof fetch
  return { fetchFn, urls }
}

const client = (fetchFn: typeof fetch) =>
  createMetaGraphClient({ appSecret: SECRET, graphVersion: 'v21.0', fetchFn })

describe('createMetaGraphClient.discoverPages', () => {
  it('envia appsecret_proof correto', async () => {
    const { fetchFn, urls } = fakeFetch([
      jsonResponse({ data: [{ id: '1', name: 'P', access_token: 'pt' }] }),
    ])
    await client(fetchFn).discoverPages(TOKEN)
    const url = new URL(urls[0]!)
    expect(url.origin + url.pathname).toBe('https://graph.facebook.com/v21.0/me/accounts')
    expect(url.searchParams.get('fields')).toBe(
      'id,name,access_token,instagram_business_account{id,username}',
    )
    expect(url.searchParams.get('access_token')).toBe(TOKEN)
    expect(url.searchParams.get('appsecret_proof')).toBe(
      createHmac('sha256', SECRET).update(TOKEN).digest('hex'),
    )
  })

  it('mapeia páginas com e sem instagram', async () => {
    const { fetchFn } = fakeFetch([
      jsonResponse({
        data: [
          {
            id: '1',
            name: 'Com IG',
            access_token: 'pt1',
            instagram_business_account: { id: 'ig1', username: 'comig' },
          },
          { id: '2', name: 'Sem IG', access_token: 'pt2' },
        ],
      }),
    ])
    expect(await client(fetchFn).discoverPages(TOKEN)).toEqual([
      {
        pageId: '1',
        pageName: 'Com IG',
        pageAccessToken: 'pt1',
        instagram: { id: 'ig1', username: 'comig' },
      },
      { pageId: '2', pageName: 'Sem IG', pageAccessToken: 'pt2', instagram: null },
    ])
  })

  it('segue paginação', async () => {
    const next = 'https://graph.facebook.com/v21.0/me/accounts?after=abc&access_token=x'
    const { fetchFn, urls } = fakeFetch([
      jsonResponse({ data: [{ id: '1', name: 'A', access_token: 'a' }], paging: { next } }),
      jsonResponse({ data: [{ id: '2', name: 'B', access_token: 'b' }] }),
    ])
    const pages = await client(fetchFn).discoverPages(TOKEN)
    expect(pages.map((p) => p.pageId)).toEqual(['1', '2'])
    expect(urls[1]).toBe(next)
  })

  it('limita a 10 páginas de resultados', async () => {
    const next = 'https://graph.facebook.com/v21.0/me/accounts?after=abc'
    const responses = Array.from({ length: 15 }, (_, i) =>
      jsonResponse({ data: [{ id: String(i), name: 'n', access_token: 't' }], paging: { next } }),
    )
    const { fetchFn, urls } = fakeFetch(responses)
    const pages = await client(fetchFn).discoverPages(TOKEN)
    expect(urls).toHaveLength(10)
    expect(pages).toHaveLength(10)
  })

  it('não segue paging.next para outro host', async () => {
    const { fetchFn, urls } = fakeFetch([
      jsonResponse({
        data: [{ id: '1', name: 'A', access_token: 'a' }],
        paging: { next: 'https://evil.example/steal' },
      }),
    ])
    await expect(client(fetchFn).discoverPages(TOKEN)).rejects.toBeInstanceOf(TransientError)
    expect(urls).toHaveLength(1)
  })

  it('erro 190 vira PermanentError com mensagem de token', async () => {
    const { fetchFn } = fakeFetch([
      jsonResponse({ error: { code: 190, type: 'OAuthException', message: 'expired' } }, 400),
    ])
    const err = await client(fetchFn)
      .discoverPages(TOKEN)
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PermanentError)
    expect((err as Error).message).toBe('Token da Meta inválido ou expirado.')
    expect((err as Error).message).not.toContain(TOKEN)
  })

  it('401 com OAuthException também é token inválido', async () => {
    const { fetchFn } = fakeFetch([jsonResponse({ error: { type: 'OAuthException' } }, 401)])
    await expect(client(fetchFn).discoverPages(TOKEN)).rejects.toThrow(
      'Token da Meta inválido ou expirado.',
    )
  })

  it('lista vazia vira PermanentError com dica do System User', async () => {
    const { fetchFn } = fakeFetch([jsonResponse({ data: [] })])
    const err = await client(fetchFn)
      .discoverPages(TOKEN)
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PermanentError)
    expect((err as Error).message).toBe(
      'Nenhuma Página encontrada para este token. Confira se a Página foi atribuída ao System User.',
    )
  })

  it('500 vira TransientError', async () => {
    const { fetchFn } = fakeFetch([jsonResponse({ error: { message: 'x' } }, 500)])
    await expect(client(fetchFn).discoverPages(TOKEN)).rejects.toBeInstanceOf(TransientError)
  })

  it('falha de rede vira TransientError sem vazar o token', async () => {
    const fetchFn = (() => Promise.reject(new Error(`boom ${TOKEN}`))) as typeof fetch
    const err = await client(fetchFn)
      .discoverPages(TOKEN)
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(TransientError)
    expect((err as Error).message).not.toContain(TOKEN)
    expect((err as Error).cause).toBeUndefined()
  })
})
