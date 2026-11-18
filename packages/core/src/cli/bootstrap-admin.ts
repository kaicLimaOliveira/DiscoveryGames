import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'
import { createPrisma, type Db } from '@central/db'
import { baseEnvSchema, loadConfig } from '@central/shared'
import { bootstrapAdmin } from '../auth/bootstrap-admin.js'
import { normalizeEmail } from '../auth/identity-service.js'
import { ConflictError } from '../errors.js'

export interface BootstrapCliDeps {
  db: Db
  out: (line: string) => void
  err: (line: string) => void
}

const OPTIONS = {
  email: { type: 'string' },
  name: { type: 'string' },
  'org-name': { type: 'string' },
  'org-slug': { type: 'string' },
} as const

const USAGE =
  'Uso: pnpm bootstrap:admin -- --email <e-mail> --name <nome> --org-name <organização> --org-slug <slug>'

/** Retorna o código de saída: 0 ok, 1 conflito (já há admin), 2 uso incorreto. */
export async function runBootstrapCli(argv: string[], deps: BootstrapCliDeps): Promise<number> {
  // pnpm repassa o "--" literal; parseArgs o trataria como fim das opções.
  const args = argv[0] === '--' ? argv.slice(1) : argv
  let values
  try {
    values = parseArgs({ args, options: OPTIONS, allowPositionals: false }).values
  } catch (e) {
    deps.err(`${(e as Error).message}\n${USAGE}`)
    return 2
  }
  const missing = (Object.keys(OPTIONS) as Array<keyof typeof OPTIONS>).filter((k) => !values[k])
  if (missing.length > 0) {
    deps.err(
      `Argumentos obrigatórios ausentes: ${missing.map((k) => `--${k}`).join(', ')}\n${USAGE}`,
    )
    return 2
  }
  try {
    const { password } = await bootstrapAdmin(deps.db, {
      email: values.email!,
      name: values.name!,
      orgName: values['org-name']!,
      orgSlug: values['org-slug']!,
    })
    deps.out(`Administrador criado: ${normalizeEmail(values.email!)}`)
    deps.out(`Senha: ${password}`)
    deps.out('Guarde esta senha agora; ela não será exibida novamente.')
    return 0
  } catch (e) {
    if (e instanceof ConflictError) {
      deps.err(`Não foi possível criar o administrador: ${e.message}`)
      return 1
    }
    throw e
  }
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const config = loadConfig(baseEnvSchema)
  const db = createPrisma(config.DATABASE_URL)
  try {
    return await runBootstrapCli(argv, {
      db,
      out: (l) => console.log(l),
      err: (l) => console.error(l),
    })
  } finally {
    await db.$disconnect()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    (code) => {
      process.exitCode = code
    },
    (e: unknown) => {
      console.error(e instanceof Error ? e.message : String(e))
      process.exitCode = 1
    },
  )
}
