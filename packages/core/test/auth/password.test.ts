import { describe, expect, it } from 'vitest'
import { hashPassword, verifyPassword } from '../../src/auth/password'

describe('password', () => {
  it('gera hash argon2id com os parâmetros OWASP', async () => {
    const hash = await hashPassword('senha-bem-longa-123')
    expect(hash.startsWith('$argon2id$v=19$m=19456,t=2,p=1$')).toBe(true)
  })

  it('aceita a senha certa e recusa a errada', async () => {
    const hash = await hashPassword('senha-bem-longa-123')
    expect(await verifyPassword(hash, 'senha-bem-longa-123')).toBe(true)
    expect(await verifyPassword(hash, 'outra-senha-longa-1')).toBe(false)
  })

  it('retorna false (sem lançar) para hash malformado', async () => {
    expect(await verifyPassword('não-é-um-hash', 'qualquer')).toBe(false)
  })
})
