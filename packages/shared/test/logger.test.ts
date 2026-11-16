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
    for (const n of names) obj[n] = `SECRET_${n}`
    log.info({ ...obj, a: { ...obj, b: { ...obj } } }, 'x')
    expect(lines.join('')).not.toContain('SECRET_')
  })

  it('redige X-Amz-Signature em string de segundo nível', () => {
    const { lines, log } = capture()
    log.info({ req: { url: 'https://x/?a=1&X-Amz-Signature=zzz9' } }, 'x')
    expect(lines.join('')).not.toContain('zzz9')
  })
})
