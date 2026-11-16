import { describe, expect, it } from 'vitest'
import { createFakeAdapter, createPlatformRegistry } from '../src'

describe('registry', () => {
  it('registra, obtém e lista adaptadores', () => {
    const r = createPlatformRegistry()
    const a = createFakeAdapter()
    r.register(a)
    expect(r.get('fake')).toBe(a)
    expect(r.list()).toEqual([a])
  })

  it('rejeita duplicado e id desconhecido', () => {
    const r = createPlatformRegistry()
    r.register(createFakeAdapter())
    expect(() => r.register(createFakeAdapter())).toThrow(/fake/)
    expect(() => r.get('tiktok')).toThrow(/tiktok/)
  })
})
