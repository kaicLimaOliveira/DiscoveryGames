import { Secret, TOTP } from 'otpauth'
import { describe, expect, it } from 'vitest'
import { generateTotpSecret, totpUri, verifyTotp } from '../../src/auth/totp'

const now = new Date('2026-01-01T00:00:10Z')

function codeAt(secret: string, at: Date): string {
  return new TOTP({
    secret: Secret.fromBase32(secret),
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
  }).generate({ timestamp: at.getTime() })
}

describe('totp', () => {
  it('gera segredo base32 de 20 bytes', () => {
    const s = generateTotpSecret()
    expect(s).toMatch(/^[A-Z2-7]{32}$/)
    expect(generateTotpSecret()).not.toBe(s)
  })

  it('monta o URI otpauth', () => {
    const uri = totpUri('JBSWY3DPEHPK3PXP', 'ana@x.com', 'Central')
    expect(uri.startsWith('otpauth://totp/')).toBe(true)
    expect(uri).toContain('secret=JBSWY3DPEHPK3PXP')
    expect(uri).toContain('issuer=Central')
  })

  it('aceita now, now+30s e now-30s e recusa now+90s', () => {
    const secret = generateTotpSecret()
    const code = codeAt(secret, now)
    expect(verifyTotp(secret, code, null, now).ok).toBe(true)
    expect(verifyTotp(secret, code, null, new Date(now.getTime() + 30_000)).ok).toBe(true)
    expect(verifyTotp(secret, code, null, new Date(now.getTime() - 30_000)).ok).toBe(true)
    expect(verifyTotp(secret, code, null, new Date(now.getTime() + 60_000)).ok).toBe(false)
    expect(verifyTotp(secret, code, null, new Date(now.getTime() + 90_000)).ok).toBe(false)
  })

  it('retorna o step correspondente ao código', () => {
    const secret = generateTotpSecret()
    const result = verifyTotp(secret, codeAt(secret, now), null, now)
    expect(result).toEqual({ ok: true, step: BigInt(Math.floor(now.getTime() / 30_000)) })
    const prev = new Date(now.getTime() - 30_000)
    const r2 = verifyTotp(secret, codeAt(secret, prev), null, now)
    expect(r2).toEqual({ ok: true, step: BigInt(Math.floor(prev.getTime() / 30_000)) })
  })

  it('rejeita replay e códigos mais antigos que o último step', () => {
    const secret = generateTotpSecret()
    const code = codeAt(secret, now)
    const first = verifyTotp(secret, code, null, now)
    if (!first.ok) throw new Error('esperava ok')
    expect(verifyTotp(secret, code, first.step, now)).toEqual({ ok: false })
    const older = codeAt(secret, new Date(now.getTime() - 30_000))
    expect(verifyTotp(secret, older, first.step, now)).toEqual({ ok: false })
    const newer = codeAt(secret, new Date(now.getTime() + 30_000))
    expect(verifyTotp(secret, newer, first.step, now).ok).toBe(true)
  })

  it('rejeita código fora do formato de 6 dígitos', () => {
    const secret = generateTotpSecret()
    for (const bad of ['', '12345', '1234567', 'abcdef', '12 456', '１２３４５６']) {
      expect(verifyTotp(secret, bad, null, now)).toEqual({ ok: false })
    }
  })

  it('retorna ok:false (sem lançar) para segredo malformado ou data inválida', () => {
    expect(verifyTotp('!!!não-base32!!!', '123456', null, now)).toEqual({ ok: false })
    const secret = generateTotpSecret()
    expect(verifyTotp(secret, '123456', null, new Date(NaN))).toEqual({ ok: false })
  })

  it('usa o relógio atual por padrão', () => {
    const secret = generateTotpSecret()
    expect(verifyTotp(secret, codeAt(secret, new Date()), null).ok).toBe(true)
  })
})
