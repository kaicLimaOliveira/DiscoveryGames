import type { PlatformAdapter, PlatformId } from './types'

export interface PlatformRegistry {
  register(a: PlatformAdapter): void
  get(id: PlatformId): PlatformAdapter
  list(): PlatformAdapter[]
}

export function createPlatformRegistry(): PlatformRegistry {
  const adapters = new Map<PlatformId, PlatformAdapter>()
  return {
    register(a) {
      if (adapters.has(a.id)) throw new Error(`Adaptador já registrado: ${a.id}`)
      adapters.set(a.id, a)
    },
    get(id) {
      const a = adapters.get(id)
      if (!a) throw new Error(`Adaptador desconhecido: ${id}`)
      return a
    },
    list() {
      return [...adapters.values()]
    },
  }
}
