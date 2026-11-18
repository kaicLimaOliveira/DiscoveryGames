import type { AccountStatus, Db, DbOrTx, SocialPlatform } from '@central/db'
import type { SecretCipher } from '@central/shared'
import { writeAudit } from '../audit.js'
import { requireOrgAccess } from '../authz/org-access.js'
import type { Actor } from '../authz/roles.js'
import { isUniqueViolation } from '../db-errors.js'
import { ConflictError, NotFoundError, ValidationError } from '../errors.js'

export interface AccountView {
  id: string
  platform: SocialPlatform
  externalId: string
  displayName: string
  status: AccountStatus
  scopes: string[]
  dailyLimit: number | null
  createdAt: Date
}

export interface LinkedAccountInput {
  platform: SocialPlatform
  externalId: string
  displayName: string
  credential: unknown
  scopes: string[]
}

export interface AccountService {
  list(actor: Actor, orgId: string): Promise<AccountView[]>
  linkTiktok(actor: Actor, orgId: string, handle: string): Promise<AccountView>
  /** Uso interno (Tasks 5 e 6). Com `tx`, escreve dentro da transação do chamador. */
  upsertLinked(
    actor: Actor,
    orgId: string,
    input: LinkedAccountInput,
    opts?: { tx?: DbOrTx },
  ): Promise<AccountView>
  /** Uso interno (workers). Decifra a credencial; nunca sai pela API. */
  readCredential(orgId: string, accountId: string): Promise<unknown>
  setDailyLimit(
    actor: Actor,
    orgId: string,
    accountId: string,
    limit: number | null,
  ): Promise<AccountView>
  disconnect(
    actor: Actor,
    orgId: string,
    accountId: string,
    revoke?: (credential: unknown) => Promise<void>,
  ): Promise<void>
}

export interface AccountLogger {
  warn(obj: Record<string, unknown>, msg: string): void
}

const HANDLE_RE = /^[a-z0-9._]{2,24}$/
const MIN_LIMIT = 1
const MAX_LIMIT = 1000
const ACCOUNT_NOT_FOUND = 'Conta não encontrada.'
const OTHER_ORG = 'Esta conta já está vinculada a outra organização.'

const VIEW_SELECT = {
  id: true,
  platform: true,
  externalId: true,
  displayName: true,
  status: true,
  scopes: true,
  dailyLimit: true,
  createdAt: true,
} as const

/** AAD pela chave natural: o id ainda não existe no momento do insert. */
function aadFor(platform: string, externalId: string): string {
  return `social_account:${platform}:${externalId}`
}

export function createAccountService(deps: {
  db: Db
  cipher: SecretCipher
  now?: () => Date
  logger?: AccountLogger
}): AccountService {
  const { db, cipher, logger } = deps

  async function loadAccount(client: DbOrTx, orgId: string, accountId: string) {
    const row = await client.socialAccount.findFirst({
      where: { id: accountId, organizationId: orgId },
    })
    if (!row) throw new NotFoundError(ACCOUNT_NOT_FOUND)
    return row
  }

  async function upsertIn(
    tx: DbOrTx,
    actor: Actor,
    orgId: string,
    input: LinkedAccountInput,
  ): Promise<AccountView> {
    await requireOrgAccess(tx, actor, orgId, 'accounts.manage')
    const { platform, externalId, displayName, scopes } = input
    const credentialEnc = cipher.encrypt(
      JSON.stringify(input.credential),
      aadFor(platform, externalId),
    )
    const existing = await tx.socialAccount.findUnique({
      where: { platform_externalId: { platform, externalId } },
      select: { id: true, organizationId: true },
    })
    if (existing && existing.organizationId !== orgId) throw new ConflictError(OTHER_ORG)

    try {
      const row = existing
        ? await tx.socialAccount.update({
            where: { id: existing.id },
            data: {
              displayName,
              credentialEnc,
              scopes,
              status: 'active',
              connectedById: actor.userId,
            },
            select: VIEW_SELECT,
          })
        : await tx.socialAccount.create({
            data: {
              organizationId: orgId,
              platform,
              externalId,
              displayName,
              credentialEnc,
              scopes,
              connectedById: actor.userId,
            },
            select: VIEW_SELECT,
          })
      await writeAudit(tx, {
        action: 'social_account.linked',
        entityType: 'social_account',
        entityId: row.id,
        userId: actor.userId,
        organizationId: orgId,
        diff: {
          platform,
          externalId,
          displayName,
          scopes,
          reconnected: existing !== undefined && existing !== null,
        },
      })
      return row
    } catch (err) {
      // Corrida: outra requisição inseriu a mesma (platform, externalId) entre a checagem e o insert.
      if (isUniqueViolation(err)) throw new ConflictError(OTHER_ORG)
      throw err
    }
  }

  async function upsertLinked(
    actor: Actor,
    orgId: string,
    input: LinkedAccountInput,
    opts?: { tx?: DbOrTx },
  ): Promise<AccountView> {
    if (opts?.tx) return upsertIn(opts.tx, actor, orgId, input)
    return db.$transaction((tx) => upsertIn(tx, actor, orgId, input))
  }

  async function readCredential(orgId: string, accountId: string): Promise<unknown> {
    const row = await loadAccount(db, orgId, accountId)
    if (row.credentialEnc === null) return null
    const plain = cipher.decrypt(row.credentialEnc, aadFor(row.platform, row.externalId))
    return JSON.parse(plain) as unknown
  }

  return {
    async list(actor, orgId) {
      await requireOrgAccess(db, actor, orgId, 'library.read')
      return db.socialAccount.findMany({
        where: { organizationId: orgId },
        orderBy: { createdAt: 'asc' },
        select: VIEW_SELECT,
      })
    },

    async linkTiktok(actor, orgId, handle) {
      await requireOrgAccess(db, actor, orgId, 'accounts.manage')
      const normalized = handle.replace(/\s+/g, '').replace(/^@+/, '').toLowerCase()
      if (!HANDLE_RE.test(normalized)) {
        throw new ValidationError(
          'Usuário do TikTok inválido: use de 2 a 24 letras, números, ponto ou sublinhado.',
        )
      }
      return upsertLinked(actor, orgId, {
        platform: 'tiktok',
        externalId: normalized,
        displayName: `@${normalized}`,
        credential: null,
        scopes: [],
      })
    },

    upsertLinked,

    readCredential,

    async setDailyLimit(actor, orgId, accountId, limit) {
      await requireOrgAccess(db, actor, orgId, 'accounts.manage')
      const before = await loadAccount(db, orgId, accountId)
      if (
        limit !== null &&
        !(Number.isInteger(limit) && limit >= MIN_LIMIT && limit <= MAX_LIMIT)
      ) {
        throw new ValidationError(
          `O limite diário deve ser um inteiro entre ${MIN_LIMIT} e ${MAX_LIMIT}, ou vazio.`,
        )
      }
      return db.$transaction(async (tx) => {
        const row = await tx.socialAccount.update({
          where: { id: before.id },
          data: { dailyLimit: limit },
          select: VIEW_SELECT,
        })
        await writeAudit(tx, {
          action: 'social_account.limit_changed',
          entityType: 'social_account',
          entityId: row.id,
          userId: actor.userId,
          organizationId: orgId,
          diff: { dailyLimit: { from: before.dailyLimit, to: limit } },
        })
        return row
      })
    },

    async disconnect(actor, orgId, accountId, revoke) {
      await requireOrgAccess(db, actor, orgId, 'accounts.manage')
      const row = await loadAccount(db, orgId, accountId)
      if (revoke) {
        // Melhor esforço: falha na revogação não impede a remoção.
        try {
          await revoke(await readCredential(orgId, accountId))
        } catch (err) {
          logger?.warn(
            {
              accountId,
              platform: row.platform,
              error: err instanceof Error ? err.message : 'erro desconhecido',
            },
            'falha ao revogar a credencial; a conta será removida mesmo assim',
          )
        }
      }
      await db.$transaction(async (tx) => {
        await tx.socialAccount.delete({ where: { id: row.id } })
        await writeAudit(tx, {
          action: 'social_account.disconnected',
          entityType: 'social_account',
          entityId: row.id,
          userId: actor.userId,
          organizationId: orgId,
          diff: { platform: row.platform, externalId: row.externalId },
        })
      })
    },
  }
}
