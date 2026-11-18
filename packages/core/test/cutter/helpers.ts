import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3'
import { MinioContainer, type StartedMinioContainer } from '@testcontainers/minio'
import type { Db } from '@central/db'
import { createStorage, type Storage } from '@central/storage'
import type { Actor } from '../../src/authz/roles.js'

// minio/minio saiu do Docker Hub; imagem Chainguard fixada por digest (igual a packages/storage).
const MINIO_IMAGE =
  'cgr.dev/chainguard/minio@sha256:18c8fa28697b25e0f34c6faae171079e88a03efb8e76a21d3b5d07b4e3cbef3e'

export const MIB = 1024 * 1024

export async function startMinio(): Promise<{ storage: Storage; stop(): Promise<void> }> {
  const container: StartedMinioContainer = await new MinioContainer(MINIO_IMAGE).start()
  const cfg = {
    S3_ENDPOINT: container.getConnectionUrl(),
    S3_REGION: 'us-east-1',
    S3_BUCKET: 'test',
    S3_ACCESS_KEY_ID: container.getUsername(),
    S3_SECRET_ACCESS_KEY: container.getPassword(),
    S3_FORCE_PATH_STYLE: true,
  }
  const admin = new S3Client({
    endpoint: cfg.S3_ENDPOINT,
    region: cfg.S3_REGION,
    forcePathStyle: true,
    credentials: { accessKeyId: cfg.S3_ACCESS_KEY_ID, secretAccessKey: cfg.S3_SECRET_ACCESS_KEY },
  })
  await admin.send(new CreateBucketCommand({ Bucket: 'test' }))
  admin.destroy()
  return {
    storage: createStorage(cfg),
    async stop() {
      await container.stop()
    },
  }
}

/** PUT direto na URL pré-assinada, como o navegador faz. */
export async function putTo(url: string, body: Uint8Array, contentType?: string): Promise<string> {
  const res = await fetch(url, {
    method: 'PUT',
    body,
    ...(contentType ? { headers: { 'Content-Type': contentType } } : {}),
  })
  if (!res.ok) throw new Error(`PUT falhou: ${res.status} ${await res.text()}`)
  return res.headers.get('etag') ?? ''
}

export async function resetDb(p: Db): Promise<void> {
  await p.clipCandidate.deleteMany()
  await p.costLedger.deleteMany()
  await p.aiRun.deleteMany()
  await p.rightsDeclaration.deleteMany()
  await p.source.deleteMany()
  await p.mediaAsset.deleteMany()
  await p.partnerCreator.deleteMany()
  await p.auditLog.deleteMany()
  await p.organizationMember.deleteMany()
  await p.user.deleteMany()
  await p.organization.deleteMany()
  await p.$executeRawUnsafe(`delete from pgboss.job`).catch(() => undefined)
}

export async function makeActor(
  p: Db,
  email: string,
  orgId: string,
  role: 'viewer' | 'editor' | 'approver' | 'admin',
): Promise<Actor> {
  const user = await p.user.create({ data: { email, name: email, passwordHash: 'x' } })
  return { userId: user.id, globalRole: 'member', memberships: [{ organizationId: orgId, role }] }
}
