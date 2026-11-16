import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    main: 'src/main.ts',
    // CLI do core empacotado: `node dist/bootstrap-admin.js --email ...` no container do worker.
    'bootstrap-admin': '../../packages/core/src/cli/bootstrap-admin.ts',
  },
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  clean: true,
  // Pacotes do workspace exportam TS; são embutidos. Dependências npm ficam externas.
  noExternal: [/^@central\//],
})
