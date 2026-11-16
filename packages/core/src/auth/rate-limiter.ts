export interface LoginRateLimiter {
  /** Maior espera restante entre as chaves, em ms (0 = liberado). */
  retryAfterMs(keys: string[]): number
  recordFailure(keys: string[]): void
  reset(key: string): void
}

/**
 * Limitador em memória com janela deslizante, por chave (IP, e-mail).
 * Limitação: o estado vive no processo; a Fase 1 roda uma única réplica do
 * web. Com mais réplicas, mover o contador para um armazenamento compartilhado.
 */
export function createLoginRateLimiter(
  opts: { max?: number; windowMs?: number; now?: () => number } = {},
): LoginRateLimiter {
  const max = opts.max ?? 5
  const windowMs = opts.windowMs ?? 900_000
  const now = opts.now ?? Date.now
  const failures = new Map<string, number[]>()

  function active(key: string, t: number): number[] {
    const recent = (failures.get(key) ?? []).filter((at) => at > t - windowMs)
    if (recent.length > 0) failures.set(key, recent)
    else failures.delete(key)
    return recent
  }

  return {
    retryAfterMs(keys) {
      const t = now()
      let wait = 0
      for (const key of keys) {
        const recent = active(key, t)
        if (recent.length >= max) {
          // Libera quando a falha que completa o limite sair da janela.
          const blockingFailure = recent[recent.length - max]!
          wait = Math.max(wait, blockingFailure + windowMs - t)
        }
      }
      return wait
    },
    recordFailure(keys) {
      const t = now()
      for (const key of keys) {
        const recent = active(key, t)
        recent.push(t)
        failures.set(key, recent)
      }
    },
    reset(key) {
      failures.delete(key)
    },
  }
}
