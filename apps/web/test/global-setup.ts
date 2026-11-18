import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { promisify } from 'node:util'
import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3'
import { createPgBossQueue } from '@central/db'
import { startTestDatabase } from '@central/db/testing'
import { MinioContainer } from '@testcontainers/minio'
import type { TestProject } from 'vitest/node'
import { ROOT_DIR, TEST_BUCKET, TEST_ORIGIN } from './constants'

const run = promisify(execFile)

// minio/minio saiu do Docker Hub; imagem Chainguard fixada por digest (a mesma de packages/storage).
const MINIO_IMAGE =
  'cgr.dev/chainguard/minio@sha256:18c8fa28697b25e0f34c6faae171079e88a03efb8e76a21d3b5d07b4e3cbef3e'

declare module 'vitest' {
  export interface ProvidedContext {
    webEnv: Record<string, string>
  }
}

async function buildNuxt(): Promise<void> {
  const require = createRequire(import.meta.url)
  const nuxtBin = resolve(dirname(require.resolve('nuxt/package.json')), 'bin/nuxt.mjs')
  await run(process.execPath, [nuxtBin, 'build'], {
    cwd: ROOT_DIR,
    env: { ...process.env, NODE_ENV: 'production' },
    maxBuffer: 64 * 1024 * 1024,
  })
}

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  // WEB_TEST_SKIP_BUILD=1 reaproveita o .output existente (iteração local nos testes).
  const build = process.env.WEB_TEST_SKIP_BUILD === '1' ? Promise.resolve() : buildNuxt()
  const [db, minio] = await Promise.all([
    startTestDatabase(),
    new MinioContainer(MINIO_IMAGE).start(),
  ])
  try {
    // O web usa pg-boss com migrate:false; o papel worker cria o schema `pgboss` uma vez.
    const queue = await createPgBossQueue({ connectionString: db.url, role: 'worker' })
    await queue.stop()

    const s3 = new S3Client({
      endpoint: minio.getConnectionUrl(),
      region: 'us-east-1',
      forcePathStyle: true,
      credentials: { accessKeyId: minio.getUsername(), secretAccessKey: minio.getPassword() },
    })
    await s3.send(new CreateBucketCommand({ Bucket: TEST_BUCKET }))
    s3.destroy()

    await build

    project.provide('webEnv', {
      DATABASE_URL: db.url,
      LOG_LEVEL: 'warn',
      APP_ORIGIN: TEST_ORIGIN,
      NUXT_SESSION_PASSWORD: randomBytes(32).toString('hex'),
      APP_ENCRYPTION_KEYS: `1:${randomBytes(32).toString('base64')}`,
      TOTP_ISSUER: 'Central de Conteúdo',
      TRUST_PROXY: 'true',
      S3_ENDPOINT: minio.getConnectionUrl(),
      S3_REGION: 'us-east-1',
      S3_BUCKET: TEST_BUCKET,
      S3_ACCESS_KEY_ID: minio.getUsername(),
      S3_SECRET_ACCESS_KEY: minio.getPassword(),
      S3_FORCE_PATH_STYLE: 'true',
    })
  } catch (err) {
    await Promise.allSettled([db.stop(), minio.stop()])
    throw err
  }

  return async () => {
    await Promise.allSettled([db.stop(), minio.stop()])
  }
}
