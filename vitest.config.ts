import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // TODO: trocar 'apps/work[e]r' por 'apps/worker' quando o app existir.
    // Vitest falha com diretório de projeto inexistente; o glob com classe de
    // caracteres tolera a ausência de apps/worker.
    projects: ['packages/*', 'apps/work[e]r'],
  },
})
