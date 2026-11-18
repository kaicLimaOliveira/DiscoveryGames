import { createHash, randomBytes } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3'
import { MinioContainer, type StartedMinioContainer } from '@testcontainers/minio'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { createStorage } from '../src/index.js'

// minio/minio saiu do Docker Hub; imagem Chainguard fixada por digest.
const MINIO_IMAGE =
  'cgr.dev/chainguard/minio@sha256:18c8fa28697b25e0f34c6faae171079e88a03efb8e76a21d3b5d07b4e3cbef3e'

let container: StartedMinioContainer | undefined
let cfg: Parameters<typeof createStorage>[0]

beforeAll(async () => {
  container = await new MinioContainer(MINIO_IMAGE).start()
  cfg = {
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
}, 120_000)
afterAll(() => container?.stop())

it('ping resolve com bucket existente', async () => {
  await expect(createStorage(cfg).ping()).resolves.toBeUndefined()
})

it('ping rejeita com bucket inexistente', async () => {
  await expect(createStorage({ ...cfg, S3_BUCKET: 'inexistente' }).ping()).rejects.toThrow()
})

it('ping rejeita com credenciais inválidas sem vazar o segredo', async () => {
  const bad = { ...cfg, S3_SECRET_ACCESS_KEY: 'segredo-errado-xyz' }
  const err = await createStorage(bad)
    .ping()
    .then(
      () => null,
      (e: unknown) => e as Error,
    )
  expect(err).toBeInstanceOf(Error)
  expect(String(err?.message)).not.toContain('segredo-errado-xyz')
})

const MIB = 1024 * 1024

async function putPart(url: string, body: Uint8Array): Promise<string> {
  const res = await fetch(url, { method: 'PUT', body })
  expect(res.ok).toBe(true)
  const etag = res.headers.get('etag')
  expect(etag).toBeTruthy()
  return etag as string
}

it('multipart: cria, envia 2 partes por URL pré-assinada e completa', async () => {
  const s = createStorage(cfg)
  const key = 'mp/original.bin'
  const { uploadId } = await s.createMultipart(key, 'application/octet-stream')
  const p1 = await putPart(await s.presignPart(key, uploadId, 1), new Uint8Array(5 * MIB).fill(1))
  const p2 = await putPart(await s.presignPart(key, uploadId, 2), new Uint8Array(1024).fill(2))
  await s.completeMultipart(key, uploadId, [
    { partNumber: 1, etag: p1 },
    { partNumber: 2, etag: p2 },
  ])
  const head = await s.head(key)
  expect(head?.sizeBytes).toBe(5 * MIB + 1024)
})

it('abortMultipart duas vezes não lança', async () => {
  const s = createStorage(cfg)
  const { uploadId } = await s.createMultipart('mp/abort.bin', 'application/octet-stream')
  await expect(s.abortMultipart('mp/abort.bin', uploadId)).resolves.toBeUndefined()
  await expect(s.abortMultipart('mp/abort.bin', uploadId)).resolves.toBeUndefined()
})

it('presignGet inline devolve o conteúdo e Content-Disposition inline', async () => {
  const s = createStorage(cfg)
  const body = new TextEncoder().encode('olá mundo')
  await putPart(await s.presignPut('get/a.txt', 'text/plain'), body)
  const res = await fetch(await s.presignGet('get/a.txt', { inline: true }))
  expect(new Uint8Array(await res.arrayBuffer())).toEqual(body)
  expect(res.headers.get('content-disposition')).toContain('inline')
})

it('presignGet com filename força download', async () => {
  const s = createStorage(cfg)
  await putPart(await s.presignPut('get/b.txt', 'text/plain'), new Uint8Array([1]))
  const res = await fetch(await s.presignGet('get/b.txt', { filename: 'clip.txt' }))
  expect(res.headers.get('content-disposition')).toContain('attachment; filename="clip.txt"')
})

it('head devolve null para chave inexistente', async () => {
  await expect(createStorage(cfg).head('nao/existe')).resolves.toBeNull()
})

it('uploadFile e downloadToFile fazem ida e volta com o mesmo sha256', async () => {
  const s = createStorage(cfg)
  const dir = await mkdtemp(join(tmpdir(), 'storage-test-'))
  try {
    const src = join(dir, 'src.bin')
    const dst = join(dir, 'dst.bin')
    await writeFile(src, randomBytes(MIB))
    await s.uploadFile('rt/file.bin', src, 'application/octet-stream')
    await s.downloadToFile('rt/file.bin', dst)
    const sha = async (p: string) =>
      createHash('sha256')
        .update(await readFile(p))
        .digest('hex')
    expect(await sha(dst)).toBe(await sha(src))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

it('delete remove o objeto', async () => {
  const s = createStorage(cfg)
  await putPart(await s.presignPut('del/a.txt', 'text/plain'), new Uint8Array([1]))
  expect(await s.head('del/a.txt')).not.toBeNull()
  await s.delete('del/a.txt')
  expect(await s.head('del/a.txt')).toBeNull()
})
