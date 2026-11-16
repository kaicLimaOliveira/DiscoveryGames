import { describe, expect, it } from 'vitest'
import { createLoginRateLimiter } from '../../src/auth/rate-limiter'

const MIN = 60_000

describe('login rate limiter', () => {
  it('bloqueia após 5 falhas e libera após 15 min', () => {
    let t = 1_000_000
    const rl = createLoginRateLimiter({ now: () => t })
    expect(rl.retryAfterMs(['email:a'])).toBe(0)
    for (let i = 0; i < 5; i++) rl.recordFailure(['ip:1', 'email:a'])
    expect(rl.retryAfterMs(['email:a'])).toBeGreaterThan(0)
    t += 15 * MIN
    expect(rl.retryAfterMs(['email:a'])).toBe(0)
  })

  it('não bloqueia com 4 falhas', () => {
    const rl = createLoginRateLimiter({ now: () => 1 })
    for (let i = 0; i < 4; i++) rl.recordFailure(['k'])
    expect(rl.retryAfterMs(['k'])).toBe(0)
  })

  it('janela deslizante: espera é até a falha mais antiga sair', () => {
    let t = 0
    const rl = createLoginRateLimiter({ now: () => t })
    for (let i = 0; i < 5; i++) {
      rl.recordFailure(['k'])
      t += MIN
    }
    // falha mais antiga em 0; agora t = 5 min
    expect(rl.retryAfterMs(['k'])).toBe(10 * MIN)
    t = 15 * MIN
    expect(rl.retryAfterMs(['k'])).toBe(0)
  })

  it('reset libera o e-mail mas não o IP', () => {
    const rl = createLoginRateLimiter({ now: () => 5 })
    for (let i = 0; i < 5; i++) rl.recordFailure(['ip:1', 'email:a'])
    rl.reset('email:a')
    expect(rl.retryAfterMs(['email:a'])).toBe(0)
    expect(rl.retryAfterMs(['ip:1'])).toBeGreaterThan(0)
  })

  it('retorna o maior tempo restante entre as chaves', () => {
    let t = 0
    const rl = createLoginRateLimiter({ now: () => t })
    for (let i = 0; i < 5; i++) rl.recordFailure(['a'])
    t = 5 * MIN
    for (let i = 0; i < 5; i++) rl.recordFailure(['b'])
    expect(rl.retryAfterMs(['a', 'b'])).toBe(15 * MIN)
    expect(rl.retryAfterMs(['a'])).toBe(10 * MIN)
  })

  it('respeita max e windowMs customizados', () => {
    let t = 0
    const rl = createLoginRateLimiter({ max: 2, windowMs: 1000, now: () => t })
    rl.recordFailure(['k'])
    rl.recordFailure(['k'])
    expect(rl.retryAfterMs(['k'])).toBe(1000)
    t = 1000
    expect(rl.retryAfterMs(['k'])).toBe(0)
  })

  it('usa Date.now por padrão', () => {
    const rl = createLoginRateLimiter()
    for (let i = 0; i < 5; i++) rl.recordFailure(['k'])
    expect(rl.retryAfterMs(['k'])).toBeGreaterThan(0)
  })
})
