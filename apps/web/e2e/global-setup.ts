import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3'
import { generateTotpSecret, hashPassword } from '@central/core'
import { createPgBossQueue, createPrisma } from '@central/db'
import { startTestDatabase } from '@central/db/testing'
import { createCipher, cryptoEnvSchema, loadConfig } from '@central/shared'
import { MinioContainer } from '@testcontainers/minio'
import { E2E_ORIGIN, E2E_PORT } from './constants'

const run = promisify(execFile)
const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BUCKET = 'central-e2e'
const ADMIN_PASSWORD = 'senha-admin-e2e-123'
// minio/minio saiu do Docker Hub; imagem Chainguard fixada por digest (a mesma dos testes do web).
const MINIO_IMAGE =
  'cgr.dev/chainguard/minio@sha256:18c8fa28697b25e0f34c6faae171079e88a03efb8e76a21d3b5d07b4e3cbef3e'

async function buildNuxt(): Promise<void> {
  const require = createRequire(import.meta.url)
  const nuxtBin = resolve(dirname(require.resolve('nuxt/package.json')), 'bin/nuxt.mjs')
  await run(process.execPath, [nuxtBin, 'build'], {
    cwd: ROOT_DIR,
    env: { ...process.env, NODE_ENV: 'production' },
    maxBuffer: 64 * 1024 * 1024,
  })
}

async function waitHealthy(child: ChildProcess, logs: string[]): Promise<void> {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`servidor encerrou:\n${logs.join('')}`)
    try {
      // /api/health responde 503 sem heartbeat do worker (não há worker no E2E): basta responder.
      const res = await fetch(`${E2E_ORIGIN}/api/health`)
      if (res.status === 200 || res.status === 503) return
    } catch {
      // ainda subindo
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`servidor não respondeu:\n${logs.join('')}`)
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  // E2E_SKIP_BUILD=1 reaproveita o .output existente (iteração local).
  const build = process.env.E2E_SKIP_BUILD === '1' ? Promise.resolve() : buildNuxt()
  const [db, minio] = await Promise.all([
    startTestDatabase(),
    new MinioContainer(MINIO_IMAGE).start(),
  ])
  let server: ChildProcess | undefined
  const stopAll = async (): Promise<void> => {
    server?.kill()
    await Promise.allSettled([db.stop(), minio.stop()])
  }
  try {
    const queue = await createPgBossQueue({ connectionString: db.url, role: 'worker' })
    await queue.stop()

    const s3 = new S3Client({
      endpoint: minio.getConnectionUrl(),
      region: 'us-east-1',
      forcePathStyle: true,
      credentials: { accessKeyId: minio.getUsername(), secretAccessKey: minio.getPassword() },
    })
    await s3.send(new CreateBucketCommand({ Bucket: BUCKET }))
    s3.destroy()

    const encryptionKeys = `1:${randomBytes(32).toString('base64')}`
    const cipher = createCipher(
      loadConfig(cryptoEnvSchema, { APP_ENCRYPTION_KEYS: encryptionKeys }).APP_ENCRYPTION_KEYS,
    )
    const prisma = createPrisma(db.url)
    const adminEmail = 'admin@e2e.test'
    const totpSecret = generateTotpSecret()
    const admin = await prisma.user.create({
      data: {
        email: adminEmail,
        name: 'Admin E2E',
        role: 'admin',
        passwordHash: await hashPassword(ADMIN_PASSWORD),
        totpEnabledAt: new Date(),
      },
    })
    await prisma.user.update({
      where: { id: admin.id },
      data: { totpSecretEnc: cipher.encrypt(totpSecret, `user:${admin.id}:totp`) },
    })
    await prisma.organization.create({ data: { name: 'Organização E2E', slug: 'organizacao-e2e' } })
    await prisma.$disconnect()

    // Herdadas pelos workers do Playwright.
    process.env.E2E_ADMIN_EMAIL = adminEmail
    process.env.E2E_ADMIN_PASSWORD = ADMIN_PASSWORD
    process.env.E2E_ADMIN_TOTP_SECRET = totpSecret
    process.env.E2E_DATABASE_URL = db.url

    await build
    const logs: string[] = []
    server = spawn(process.execPath, ['.output/server/index.mjs'], {
      cwd: ROOT_DIR,
      env: {
        ...process.env,
        NODE_ENV: 'production',
        PORT: String(E2E_PORT),
        HOST: '127.0.0.1',
        DATABASE_URL: db.url,
        LOG_LEVEL: 'warn',
        APP_ORIGIN: E2E_ORIGIN,
        NUXT_SESSION_PASSWORD: randomBytes(32).toString('hex'),
        APP_ENCRYPTION_KEYS: encryptionKeys,
        TOTP_ISSUER: 'Central de Conteúdo',
        TRUST_PROXY: 'false',
        S3_ENDPOINT: minio.getConnectionUrl(),
        S3_REGION: 'us-east-1',
        S3_BUCKET: BUCKET,
        S3_ACCESS_KEY_ID: minio.getUsername(),
        S3_SECRET_ACCESS_KEY: minio.getPassword(),
        S3_FORCE_PATH_STYLE: 'true',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    server.stdout?.on('data', (d: Buffer) => logs.push(d.toString()))
    server.stderr?.on('data', (d: Buffer) => logs.push(d.toString()))
    await waitHealthy(server, logs)
  } catch (err) {
    await stopAll()
    throw err
  }
  return stopAll
}
