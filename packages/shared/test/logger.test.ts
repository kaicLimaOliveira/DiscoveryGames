import { describe, expect, it } from 'vitest'
import { createLogger, withContext, REDACT_PATHS } from '../src/logger'

function capture() {
  const lines: string[] = []
  const log = createLogger({ name: 't', destination: { write: (s: string) => void lines.push(s) } })
  return { lines, log }
}

describe('logger', () => {
  it('redige segredos em qualquer profundidade e mantém contexto', () => {
    const { lines, log: base } = capture()
    const log = withContext(base, { requestId: 'r1', jobId: 'j1' })
    log.info(
      {
        headers: { authorization: 'Bearer AAA', cookie: 'c=1' },
        body: {
          password: 'p',
          access_token: 'tok',
          refresh_token: 'rt',
          client_secret: 'cs',
          code: 'oc',
          totpSecret: 'ts',
        },
        url: 'https://x/o?X-Amz-Signature=abc123&a=1',
      },
      'msg',
    )
    const out = lines.join('')
    for (const s of ['Bearer AAA', 'c=1', '"p"', '"tok"', '"rt"', '"cs"', '"oc"', '"ts"', 'abc123'])
      expect(out).not.toContain(s)
    const j = JSON.parse(lines[0]!)
    expect(j.requestId).toBe('r1')
    expect(j.jobId).toBe('j1')
    expect(j.name).toBe('t')
    expect(j.url).toBe('https://x/o?X-Amz-Signature=[REDACTED]&a=1')
    expect(j.body.password).toBe('[REDACTED]')
  })

  it('redige todos os nomes no topo e aninhados em 3 níveis', () => {
    const { lines, log } = capture()
    const names = [...new Set(REDACT_PATHS.map((p) => p.split('.').pop()!))]
    expect(names.sort()).toEqual(
      [
        'access_token',
        'authorization',
        'client_secret',
        'code',
        'cookie',
        'password',
        'refresh_token',
        'totpSecret',
      ].sort(),
    )
    const obj: Record<string, unknown> = {}
    // `code` é tratado à parte (só em query/body/params).
    for (const n of names.filter((x) => x !== 'code')) obj[n] = `SECRET_${n}`
    log.info({ ...obj, a: { ...obj, b: { ...obj } } }, 'x')
    expect(lines.join('')).not.toContain('SECRET_')
  })

  it('redige code só em query/body/params; err.code (ECONNREFUSED, P2002) sobrevive', () => {
    const { lines, log } = capture()
    const err = Object.assign(new Error('boom'), { code: 'ECONNREFUSED' })
    log.info(
      {
        err,
        db: { code: 'P2002' },
        body: { code: 'oauth-body' },
        req: { query: { code: 'oauth-query' }, params: { code: 'oauth-params' } },
      },
      'x',
    )
    const out = lines.join('')
    const j = JSON.parse(lines[0]!)
    expect(j.err.code).toBe('ECONNREFUSED')
    expect(j.db.code).toBe('P2002')
    expect(j.body.code).toBe('[REDACTED]')
    expect(out).not.toContain('oauth-')
  })

  it('redige X-Amz-Signature em string de segundo nível', () => {
    const { lines, log } = capture()
    log.info({ req: { url: 'https://x/?a=1&X-Amz-Signature=zzz9' } }, 'x')
    expect(lines.join('')).not.toContain('zzz9')
  })

  it('preserva valores não-planos (Date, URL, Map, Buffer)', () => {
    const { lines, log } = capture()
    const d = new Date('2026-01-02T03:04:05.000Z')
    log.info({ scheduledAt: d, u: new URL('https://x/y'), n: { at: d } }, 'x')
    const j = JSON.parse(lines[0]!)
    expect(j.scheduledAt).toBe(d.toISOString())
    expect(j.u).toBe('https://x/y')
    expect(j.n.at).toBe(d.toISOString())
  })

  it('redige X-Amz-Signature em erros', () => {
    const { lines, log } = capture()
    log.error({ err: new Error('GET https://x/o?X-Amz-Signature=abc123 failed') }, 'x')
    const out = lines.join('')
    expect(out).not.toContain('abc123')
    expect(JSON.parse(lines[0]!).err.message).toContain('X-Amz-Signature=[REDACTED]')
  })

  it('redige X-Amz-Signature na mensagem do log', () => {
    const { lines, log } = capture()
    log.info('fetch https://x/o?X-Amz-Signature=abc123&a=1')
    log.info({ a: 1 }, 'fetch https://x/o?X-Amz-Signature=def456')
    const out = lines.join('')
    expect(out).not.toContain('abc123')
    expect(out).not.toContain('def456')
  })

  it('redige chaves sensíveis em qualquer caixa e formato', () => {
    const { lines, log } = capture()
    log.info(
      {
        accessToken: 'a',
        refresh_token: 'b',
        Authorization: 'Bearer c',
        'set-cookie': 'd',
        nested: { ACCESS_TOKEN: 'e', credentialEnc: 'f' },
        err: { code: 'ECONNREFUSED' },
      },
      'x',
    )
    const out = lines.join('')
    for (const v of ['"a"', '"b"', 'Bearer c', '"d"', '"e"', '"f"']) expect(out).not.toContain(v)
    const j = JSON.parse(lines[0]!)
    expect(j.accessToken).toBe('[REDACTED]')
    expect(j.refresh_token).toBe('[REDACTED]')
    expect(j.Authorization).toBe('[REDACTED]')
    expect(j['set-cookie']).toBe('[REDACTED]')
    expect(j.nested.ACCESS_TOKEN).toBe('[REDACTED]')
    expect(j.nested.credentialEnc).toBe('[REDACTED]')
    expect(j.err.code).toBe('ECONNREFUSED')
  })

  it('redige chaves sensíveis dentro de erros', () => {
    const { lines, log } = capture()
    const err = Object.assign(new Error('falhou'), {
      token: 'xtok',
      response: { headers: { Authorization: 'Bearer ytok' } },
    })
    log.error({ err: new Error('externo', { cause: err }) }, 'x')
    log.error({ err }, 'x')
    const out = lines.join('')
    expect(out).not.toContain('xtok')
    expect(out).not.toContain('ytok')
  })

  it('redige tokens em strings (query string e Bearer)', () => {
    const { lines, log } = capture()
    const url =
      'GET https://graph.facebook.com/v1.0/me/accounts?fields=id&access_token=SECRET1&appsecret_proof=SECRET2'
    log.error({ err: new Error(url) }, url)
    log.info({ h: 'Authorization: Bearer SECRET3' }, 'Authorization: Bearer SECRET3')
    const out = lines.join('')
    for (const v of ['SECRET1', 'SECRET2', 'SECRET3']) expect(out).not.toContain(v)
    expect(out).toContain('fields=id')
  })

  it('redige chaves com sufixo sensível (pageAccessToken, googleRefreshToken, x-api-key)', () => {
    const { lines, log } = capture()
    log.info(
      {
        pageAccessToken: 'S1',
        nested: { googleRefreshToken: 'S2', headers: { 'x-api-key': 'S3' }, dbPassword: 'S4' },
        metaAppSecret: 'S5',
        accountCredential: 'S6',
      },
      'x',
    )
    expect(lines.join('')).not.toMatch(/S[1-6]/)
  })

  it('não redige em excesso: tokenType, err.code e campos normais ficam', () => {
    const { lines, log } = capture()
    const err = Object.assign(new Error('falhou'), { code: 'ECONNREFUSED' })
    log.info({ tokenType: 'Bearer', maxTokens: 10, platform: 'meta', err }, 'x')
    const j = JSON.parse(lines[0]!)
    expect(j.tokenType).toBe('Bearer')
    expect(j.maxTokens).toBe(10)
    expect(j.platform).toBe('meta')
    expect(j.err.code).toBe('ECONNREFUSED')
    expect(j.err.message).toBe('falhou')
  })
})
