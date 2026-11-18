import { createReadStream, createWriteStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import type { Readable } from 'node:stream'
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3'
import { Upload } from '@aws-sdk/lib-storage'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import type { storageEnvSchema } from '@central/shared'
import type { z } from 'zod'

export type StorageConfig = z.infer<typeof storageEnvSchema>

/** Tamanho das partes do upload multipart (64 MiB; 4 GB cabem em ~64 partes, longe do limite de 10 mil). */
export const MULTIPART_PART_BYTES = 64 * 1024 * 1024

const DEFAULT_EXPIRES_SEC = 3600

export interface Storage {
  ping(): Promise<void>
  createMultipart(key: string, contentType: string): Promise<{ uploadId: string }>
  presignPart(
    key: string,
    uploadId: string,
    partNumber: number,
    expiresSec?: number,
  ): Promise<string>
  completeMultipart(
    key: string,
    uploadId: string,
    parts: Array<{ partNumber: number; etag: string }>,
  ): Promise<void>
  /** Não falha se o upload já não existir. */
  abortMultipart(key: string, uploadId: string): Promise<void>
  /** A URL de PUT não impõe tamanho: quem chama confere com `head` depois. */
  presignPut(key: string, contentType: string, expiresSec?: number): Promise<string>
  presignGet(
    key: string,
    opts?: { expiresSec?: number; inline?: boolean; filename?: string },
  ): Promise<string>
  /** `null` quando o objeto não existe (404). */
  head(key: string): Promise<{ sizeBytes: number; contentType?: string } | null>
  /** Em stream, sem carregar o objeto na memória. */
  downloadToFile(key: string, path: string): Promise<void>
  uploadFile(key: string, path: string, contentType: string): Promise<void>
  delete(key: string): Promise<void>
}

function errorName(e: unknown): string | undefined {
  return typeof e === 'object' && e !== null ? (e as { name?: string }).name : undefined
}

function isNotFound(e: unknown): boolean {
  const status = (e as { $metadata?: { httpStatusCode?: number } } | null)?.$metadata
    ?.httpStatusCode
  return status === 404 || errorName(e) === 'NotFound' || errorName(e) === 'NoSuchKey'
}

export function createStorage(cfg: StorageConfig): Storage {
  const client = new S3Client({
    endpoint: cfg.S3_ENDPOINT,
    region: cfg.S3_REGION,
    forcePathStyle: cfg.S3_FORCE_PATH_STYLE,
    credentials: {
      accessKeyId: cfg.S3_ACCESS_KEY_ID,
      secretAccessKey: cfg.S3_SECRET_ACCESS_KEY,
    },
  })
  const Bucket = cfg.S3_BUCKET
  return {
    async ping() {
      await client.send(new HeadBucketCommand({ Bucket }))
    },

    async createMultipart(key, contentType) {
      const out = await client.send(
        new CreateMultipartUploadCommand({ Bucket, Key: key, ContentType: contentType }),
      )
      if (!out.UploadId) throw new Error('Storage não devolveu o uploadId do multipart')
      return { uploadId: out.UploadId }
    },

    presignPart(key, uploadId, partNumber, expiresSec = DEFAULT_EXPIRES_SEC) {
      return getSignedUrl(
        client,
        new UploadPartCommand({ Bucket, Key: key, UploadId: uploadId, PartNumber: partNumber }),
        { expiresIn: expiresSec },
      )
    },

    async completeMultipart(key, uploadId, parts) {
      await client.send(
        new CompleteMultipartUploadCommand({
          Bucket,
          Key: key,
          UploadId: uploadId,
          MultipartUpload: {
            Parts: [...parts]
              .sort((a, b) => a.partNumber - b.partNumber)
              .map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })),
          },
        }),
      )
    },

    async abortMultipart(key, uploadId) {
      try {
        await client.send(new AbortMultipartUploadCommand({ Bucket, Key: key, UploadId: uploadId }))
      } catch (e) {
        if (errorName(e) === 'NoSuchUpload' || isNotFound(e)) return
        throw e
      }
    },

    presignPut(key, contentType, expiresSec = DEFAULT_EXPIRES_SEC) {
      return getSignedUrl(
        client,
        new PutObjectCommand({ Bucket, Key: key, ContentType: contentType }),
        { expiresIn: expiresSec },
      )
    },

    presignGet(key, opts = {}) {
      const disposition = opts.inline
        ? 'inline'
        : opts.filename
          ? `attachment; filename="${opts.filename.replace(/["\\r\n]/g, '_')}"`
          : undefined
      return getSignedUrl(
        client,
        new GetObjectCommand({ Bucket, Key: key, ResponseContentDisposition: disposition }),
        { expiresIn: opts.expiresSec ?? DEFAULT_EXPIRES_SEC },
      )
    },

    async head(key) {
      try {
        const out = await client.send(new HeadObjectCommand({ Bucket, Key: key }))
        return {
          sizeBytes: out.ContentLength ?? 0,
          ...(out.ContentType ? { contentType: out.ContentType } : {}),
        }
      } catch (e) {
        if (isNotFound(e)) return null
        throw e
      }
    },

    async downloadToFile(key, path) {
      const out = await client.send(new GetObjectCommand({ Bucket, Key: key }))
      await pipeline(out.Body as Readable, createWriteStream(path))
    },

    async uploadFile(key, path, contentType) {
      const upload = new Upload({
        client,
        params: { Bucket, Key: key, Body: createReadStream(path), ContentType: contentType },
        partSize: MULTIPART_PART_BYTES,
        queueSize: 2,
      })
      await upload.done()
    },

    async delete(key) {
      await client.send(new DeleteObjectCommand({ Bucket, Key: key }))
    },
  }
}
