import { HeadBucketCommand, S3Client } from '@aws-sdk/client-s3'
import type { storageEnvSchema } from '@central/shared'
import type { z } from 'zod'

export type StorageConfig = z.infer<typeof storageEnvSchema>

export interface Storage {
  ping(): Promise<void>
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
  return {
    async ping() {
      await client.send(new HeadBucketCommand({ Bucket: cfg.S3_BUCKET }))
    },
  }
}
