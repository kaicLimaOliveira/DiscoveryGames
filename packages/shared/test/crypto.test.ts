import { describe, expect, it } from 'vitest'
import { createCipher } from '../src/crypto'

const k = (b: number) => Buffer.alloc(32, b)

describe('createCipher', () => {
  it('round-trip com a maior versão', () => {
    const c = createCipher(
      new Map([
        [1, k(1)],
        [2, k(2)],
      ]),
    )
    const t = c.encrypt('segredo', 'user:1:totp')
    expect(c.currentVersion).toBe(2)
    expect(t.startsWith('2.')).toBe(true)
    expect(c.decrypt(t, 'user:1:totp')).toBe('segredo')
  })
  it('IV único por valor', () => {
    const c = createCipher(new Map([[1, k(1)]]))
    expect(c.encrypt('x', 'a')).not.toBe(c.encrypt('x', 'a'))
  })
  it('AAD diferente falha (impede trocar cifrados entre linhas)', () => {
    const c = createCipher(new Map([[1, k(1)]]))
    expect(() => c.decrypt(c.encrypt('x', 'user:1'), 'user:2')).toThrow()
  })
  it('decifra versão antiga e sinaliza rotação', () => {
    const old = createCipher(new Map([[1, k(1)]])).encrypt('x', 'a')
    const c = createCipher(
      new Map([
        [1, k(1)],
        [2, k(2)],
      ]),
    )
    expect(c.decrypt(old, 'a')).toBe('x')
    expect(c.needsRotation(old)).toBe(true)
    expect(c.needsRotation(c.encrypt('x', 'a'))).toBe(false)
  })
  it('versão desconhecida ou token adulterado lança erro', () => {
    const c = createCipher(new Map([[1, k(1)]]))
    expect(() => c.decrypt('9.a.b.c', 'a')).toThrow(/versão/)
    const t = c.encrypt('x', 'a')
    expect(() => c.decrypt(t.slice(0, -2) + 'AA', 'a')).toThrow()
  })
  it('token malformado lança erro claro sem vazar o token', () => {
    const c = createCipher(new Map([[1, k(1)]]))
    const t = c.encrypt('x', 'a')
    expect(() => c.decrypt('lixo', 'a')).toThrow(/malformado/)
    expect(() => c.decrypt('1.a.b', 'a')).toThrow(/malformado/)
    expect(() => c.decrypt('1.a.b.c', 'a')).toThrow(/malformado/)
    expect(() => c.decrypt('1.a+/.b.c', 'a')).toThrow(/malformado/)
    expect(() => c.needsRotation('lixo')).toThrow(/malformado/)
    try {
      c.decrypt(t, 'outro')
    } catch (e) {
      expect(String(e)).not.toContain(t)
    }
  })
  it('rejeita mapa vazio e chaves que não têm 32 bytes', () => {
    expect(() => createCipher(new Map())).toThrow()
    expect(() => createCipher(new Map([[1, Buffer.alloc(16)]]))).toThrow()
  })
})
