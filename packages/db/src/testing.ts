import { execFile } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { PostgreSqlContainer } from '@testcontainers/postgresql'
import pg from 'pg'
import type { PrismaClient } from './generated/prisma/client.js'
import { createPrisma } from './client.js'

const run = promisify(execFile)
const pkgDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function prismaBin(): string {
  const require = createRequire(import.meta.url)
  const pkgJson = require.resolve('prisma/package.json')
  return resolve(dirname(pkgJson), 'build/index.js')
}

/**
 * Sobe um Postgres descartável e aplica as migrações.
 * `upTo` aplica só até essa migração (inclusive), para testar migrações de dados.
 */
async function migrateDeploy(url: string): Promise<void> {
  await run(process.execPath, [prismaBin(), 'migrate', 'deploy'], {
    cwd: pkgDir,
    env: { ...process.env, DATABASE_URL: url },
  })
}

/** Aplica, em ordem, as migrações cujo nome é <= `upTo`, via SQL direto. */
async function applyMigrations(url: string, upTo: string): Promise<void> {
  const dir = resolve(pkgDir, 'prisma/migrations')
  const names = readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()
    .filter((n) => n <= upTo)
  const client = new pg.Client({ connectionString: url })
  await client.connect()
  try {
    for (const n of names)
      await client.query(readFileSync(resolve(dir, n, 'migration.sql'), 'utf8'))
  } finally {
    await client.end()
  }
}

/** Aplica o restante das migrações pendentes (usado após `upTo`). */
export async function applyRemainingMigrations(url: string, applied: string[]): Promise<void> {
  const dir = resolve(pkgDir, 'prisma/migrations')
  const client = new pg.Client({ connectionString: url })
  await client.connect()
  try {
    const names = readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort()
      .filter((n) => !applied.includes(n))
    for (const n of names)
      await client.query(readFileSync(resolve(dir, n, 'migration.sql'), 'utf8'))
  } finally {
    await client.end()
  }
}

export async function startTestDatabase(opts: { upTo?: string } = {}): Promise<{
  url: string
  prisma: PrismaClient
  stop(): Promise<void>
}> {
  const container = await new PostgreSqlContainer('postgres:17').start()
  const url = container.getConnectionUri()
  try {
    if (opts.upTo) await applyMigrations(url, opts.upTo)
    else await migrateDeploy(url)
  } catch (err) {
    await container.stop()
    throw err
  }
  const prisma = createPrisma(url)
  return {
    url,
    prisma,
    async stop() {
      await prisma.$disconnect()
      await container.stop()
    },
  }
}
