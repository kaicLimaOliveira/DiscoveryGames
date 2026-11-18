import {
  createAccountService,
  createIdentityService,
  createBudgetService,
  createCandidateService,
  createLoginRateLimiter,
  createOrganizationService,
  createPartnerCreatorService,
  createSourceService,
  type AccountService,
  type BudgetService,
  type CandidateService,
  type IdentityService,
  type OrganizationService,
  type PartnerCreatorService,
  type SourceService,
} from '@central/core'
import { createPgBossQueue, createPrisma, type Db, type PgBossQueue } from '@central/db'
import { createCipher, createLogger, type JobQueue } from '@central/shared'
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
  sources: SourceService
  candidates: CandidateService
  partnerCreators: PartnerCreatorService
  budget: BudgetService
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
  // O serviço de fontes pede um JobQueue síncrono; a fila pg-boss conecta na primeira
  // chamada (lazy), então o adaptador espera `queue()` a cada envio.
  const jobQueue: JobQueue = {
    async send(name, data, opts) {
      return (await services!.queue()).send(name, data, opts)
    },
  }
  const sources = createSourceService({ db, storage, queue: jobQueue, logger })
  const candidates = createCandidateService({ db, storage })
  const partnerCreators = createPartnerCreatorService({ db, storage })
  const budget = createBudgetService({ db })
  const meta = metaConfig(config)
  const google = googleConfig(config)
  services = {
    db,
    identity,
    organizations,
    accounts,
    sources,
    candidates,
    partnerCreators,
    budget,
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
