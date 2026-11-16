/**
 * O Nitro troca `import.meta` por `globalThis._importMeta_`, cuja `url` nos chunks é
 * "file:///_entry.js" (sem unidade de disco no Windows). O cliente Prisma gerado faz
 * `fileURLToPath(import.meta.url)` ao carregar; aqui volta a usar a URL real do chunk ESM.
 *
 * Se o Nitro ou o Prisma mudarem o código gerado, o build falha (em vez de quebrar só em
 * runtime no Windows): o chunk com o cliente Prisma precisa conter o padrão esperado.
 */
const PRISMA_MARKER = 'getPrismaClient('
const IMPORT_META_FROM = 'fileURLToPath(globalThis._importMeta_.url)'
const IMPORT_META_TO = 'fileURLToPath(import.meta.url)'

const prismaImportMetaUrl = {
  name: 'central:prisma-import-meta-url',
  renderChunk(code: string, chunk: { fileName: string }) {
    if (!code.includes(PRISMA_MARKER)) return null
    if (!code.includes(IMPORT_META_FROM)) {
      throw new Error(
        `[central:prisma-import-meta-url] padrão "${IMPORT_META_FROM}" não encontrado no ` +
          `chunk do Prisma (${chunk.fileName}); revise o patch.`,
      )
    }
    return { code: code.replaceAll(IMPORT_META_FROM, IMPORT_META_TO), map: null }
  },
}

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2026-11-01',
  modules: ['nuxt-auth-utils'],
  devtools: { enabled: false },
  telemetry: false,
  typescript: {
    // node_modules do app (links do pnpm) e os testes (tsconfig próprio) ficam fora do projeto app.
    tsConfig: { exclude: ['../node_modules', '../test'] },
  },
  runtimeConfig: {
    // A senha do selo vem de NUXT_SESSION_PASSWORD (lida pelo nuxt-auth-utils em runtime).
    session: {
      password: '',
      name: 'central-session',
      maxAge: 60 * 60 * 12,
      cookie: { sameSite: 'lax', httpOnly: true, secure: true },
    },
  },
  $development: {
    runtimeConfig: { session: { password: '', cookie: { secure: false } } },
  },
  nitro: {
    preset: 'node-server',
  },
  hooks: {
    // Handler de erro da API antes do handler do Nuxt (cadeia do Nitro: o primeiro que responde).
    'nitro:config'(config) {
      const nuxtHandlers = [config.errorHandler ?? []].flat()
      config.errorHandler = ['~~/server/error', ...nuxtHandlers]
    },
    'nitro:init'(nitro) {
      nitro.hooks.hook('rollup:before', (_nitro, config) => {
        const plugins = Array.isArray(config.plugins) ? config.plugins : [config.plugins]
        config.plugins = [...plugins, prismaImportMetaUrl]
      })
    },
  },
})
