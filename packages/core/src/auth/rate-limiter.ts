export interface LoginRateLimiter {
  /** Maior espera restante entre as chaves, em ms (0 = liberado). */
  retryAfterMs(keys: string[]): number
  /**
   * Registra uma falha por chave. Registrar enquanto bloqueado estende o
   * bloqueio (janela deslizante); o chamador deve consultar `retryAfterMs`
   * antes e não registrar falhas enquanto a chave estiver bloqueada.
   */
  recordFailure(keys: string[]): void
  reset(key: string): void
  /** Número de chaves em memória (testes/observabilidade). */
  size(): number
}

/**
 * Limitador em memória com janela deslizante, por chave (IP, e-mail).
 * Limitação: o estado vive no processo; a Fase 1 roda uma única réplica do
 * web. Com mais réplicas, mover o contador para um armazenamento compartilhado.
 */
export function createLoginRateLimiter(
  opts: { max?: number; windowMs?: number; maxKeys?: number; now?: () => number } = {},
): LoginRateLimiter {
  const max = opts.max ?? 5
  const windowMs = opts.windowMs ?? 900_000
  const maxKeys = opts.maxKeys ?? 10_000
  const now = opts.now ?? Date.now
  const SWEEP_EVERY = 100
  let calls = 0
  const failures = new Map<string, number[]>()

  function active(key: string, t: number): number[] {
    const recent = (failures.get(key) ?? []).filter((at) => at > t - windowMs)
    if (recent.length > 0) failures.set(key, recent)
    else failures.delete(key)
    return recent
  }

  // Remove chaves expiradas; se ainda acima do teto, descarta as mais antigas
  // (ordem de inserção do Map, que é renovada a cada falha registrada).
  function sweep(t: number): void {
    for (const [key, stamps] of failures) {
      if (stamps[stamps.length - 1]! <= t - windowMs) failures.delete(key)
    }
    for (const key of failures.keys()) {
      if (failures.size <= maxKeys) break
      failures.delete(key)
    }
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
        // Só as últimas `max` falhas importam para o cálculo.
        failures.delete(key)
        failures.set(key, recent.slice(-max))
      }
      calls++
      if (failures.size > maxKeys || calls % SWEEP_EVERY === 0) sweep(t)
    },
    reset(key) {
      failures.delete(key)
    },
    size() {
      return failures.size
    },
  }
}
