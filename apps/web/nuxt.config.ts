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

/**
 * O leitor de assets públicos do Nitro resolve `../public/...` a partir de
 * `dirname(import.meta.url)` do chunk (`server/chunks/_/`), não de `server/`: todos os
 * arquivos de `/_nuxt/` davam 404 no build de produção. Aqui sobe do chunk até `server/`.
 * O build falha se o padrão mudar.
 */
const ASSET_MARKER = 'function readAsset'
const ASSET_FROM = 'const serverDir = dirname(fileURLToPath(globalThis._importMeta_.url));'

/**
 * Reproduzido também no Linux (node:24-slim): sem este patch `/_nuxt/*` responde 404;
 * não é um problema só do Windows.
 */
function createNitroPatches() {
  let assetPatched = false
  let prismaPatched = false
  return {
    name: 'central:nitro-patches',
    renderChunk(code: string, chunk: { fileName: string }) {
      let out = code
      if (out.includes(ASSET_MARKER)) {
        if (!out.includes(ASSET_FROM)) {
          throw new Error(
            `[central:nitro-patches] padrão do leitor de assets não encontrado no chunk ` +
              `(${chunk.fileName}); revise o patch.`,
          )
        }
        // Sobe da pasta do chunk (ex.: chunks/nitro/) até server/; na raiz, './' (nunca '').
        const up = '../'.repeat(chunk.fileName.split('/').length - 1) || './'
        out = out.replace(
          ASSET_FROM,
          `const serverDir = fileURLToPath(new URL(${JSON.stringify(up)}, import.meta.url));`,
        )
        assetPatched = true
      }
      if (out.includes(PRISMA_MARKER)) {
        if (!out.includes(IMPORT_META_FROM)) {
          throw new Error(
            `[central:nitro-patches] padrão "${IMPORT_META_FROM}" não encontrado no ` +
              `chunk do Prisma (${chunk.fileName}); revise o patch.`,
          )
        }
        out = out.replaceAll(IMPORT_META_FROM, IMPORT_META_TO)
        prismaPatched = true
      }
      return out === code ? null : { code: out, map: null }
    },
    // Os dois patches são obrigatórios: se o Nitro/Prisma mudarem a ponto de o padrão nem
    // aparecer, o build falha em vez de gerar um servidor quebrado (assets 404 / Prisma).
    generateBundle() {
      const missing = [
        ...(assetPatched ? [] : ['leitor de assets do Nitro (readAsset)']),
        ...(prismaPatched ? [] : ['cliente Prisma (getPrismaClient)']),
      ]
      if (missing.length) {
        throw new Error(`[central:nitro-patches] patch não aplicado: ${missing.join(', ')}.`)
      }
    },
  }
}

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2026-11-01',
  modules: ['@nuxt/ui', 'nuxt-auth-utils'],
  css: ['~/assets/css/main.css'],
  // Sem fontes externas: a CSP só permite recursos da própria origem.
  ui: { fonts: false },
  // Ícones embutidos no bundle do cliente: nada de API do Iconify (a CSP bloqueia) e o
  // /api/_nuxt_icon cairia no middleware de sessão.
  icon: { clientBundle: { scan: true }, fallbackToApi: false },
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
      // Os patches são só do build de produção (no dev o bundle é outro e a asserção obrigatória
      // derrubaria o servidor).
      if (nitro.options.dev) return
      nitro.hooks.hook('rollup:before', (_nitro, config) => {
        const plugins = Array.isArray(config.plugins) ? config.plugins : [config.plugins]
        config.plugins = [...plugins, createNitroPatches()]
      })
    },
  },
})
