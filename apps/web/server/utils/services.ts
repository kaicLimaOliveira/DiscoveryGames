import {
  createAccountService,
  createIdentityService,
  createLoginRateLimiter,
  createOrganizationService,
  type AccountService,
  type IdentityService,
  type OrganizationService,
} from '@central/core'
import { createPgBossQueue, createPrisma, type Db, type PgBossQueue } from '@central/db'
import { createCipher, createLogger } from '@central/shared'
import {
  createGoogleOAuth,
  createMetaGraphClient,
  type GoogleOAuth,
  type MetaGraphClient,
} from '@central/platforms'
import { createStorage, type Storage } from '@central/storage'
import { googleConfig, metaConfig, useWebConfig } from './config'

export type Logger = ReturnType<typeof createLogger>

export interface Services {
  db: Db
  identity: IdentityService
  organizations: OrganizationService
  accounts: AccountService
  storage: Storage
  /** Cliente da Graph API; `null` quando a integração Meta não está configurada. */
  metaGraph: MetaGraphClient | null
  /** OAuth do Google/YouTube; `null` quando não está configurado. */
  google: GoogleOAuth | null
  /** Fila pg-boss (papel `web`, sem migrações), conectada na primeira chamada. */
  queue(): Promise<PgBossQueue>
  logger: Logger
}

let services: Services | undefined
let queuePromise: Promise<PgBossQueue> | undefined

/** Singleton lazy por processo Nitro. */
export function useServices(): Services {
  if (services) return services
  const config = useWebConfig()
  const logger = createLogger({ name: 'web', level: config.LOG_LEVEL })
  const db = createPrisma(config.DATABASE_URL)
  // Um único limitador por processo, compartilhado pelo serviço de identidade.
  const limiter = createLoginRateLimiter()
  const cipher = createCipher(config.APP_ENCRYPTION_KEYS)
  const identity = createIdentityService({
    db,
    cipher,
    limiter,
    totpIssuer: config.TOTP_ISSUER,
  })
  const organizations = createOrganizationService({ db })
  const accounts = createAccountService({ db, cipher, logger })
  const storage = createStorage(config)
  const meta = metaConfig(config)
  const google = googleConfig(config)
  services = {
    db,
    identity,
    organizations,
    accounts,
    storage,
    metaGraph: meta ? createMetaGraphClient(meta) : null,
    google: google ? createGoogleOAuth(google) : null,
    logger,
    queue() {
      queuePromise ??= createPgBossQueue({
        connectionString: config.DATABASE_URL,
        role: 'web',
        onError: (err) => logger.error({ err }, 'pg-boss error'),
      }).catch((err: unknown) => {
        queuePromise = undefined
        throw err
      })
      return queuePromise
    },
  }
  return services
}

/** Encerra conexões (hook `close` do Nitro). */
export async function closeServices(): Promise<void> {
  if (!services) return
  const { db } = services
  const queue = queuePromise
  services = undefined
  queuePromise = undefined
  await Promise.allSettled([db.$disconnect(), queue?.then((q) => q.stop())])
}
