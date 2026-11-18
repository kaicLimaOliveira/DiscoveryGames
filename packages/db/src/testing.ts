import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { PostgreSqlContainer } from '@testcontainers/postgresql'
import type { PrismaClient } from './generated/prisma/client.js'
import { createPrisma } from './client.js'

const run = promisify(execFile)
const pkgDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function prismaBin(): string {
  const require = createRequire(import.meta.url)
  const pkgJson = require.resolve('prisma/package.json')
  return resolve(dirname(pkgJson), 'build/index.js')
}

export async function startTestDatabase(): Promise<{
  url: string
  prisma: PrismaClient
  stop(): Promise<void>
}> {
  const container = await new PostgreSqlContainer('postgres:17').start()
  const url = container.getConnectionUri()
  try {
    await run(process.execPath, [prismaBin(), 'migrate', 'deploy'], {
      cwd: pkgDir,
      env: { ...process.env, DATABASE_URL: url },
    })
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
