import type { CostCategory, Db, DbOrTx } from '@central/db'
import { writeAudit } from '../audit.js'
import { requireOrgAccess } from '../authz/org-access.js'
import type { Actor } from '../authz/roles.js'
import { isUniqueViolation } from '../db-errors.js'
import { NotFoundError } from '../errors.js'

/** Fração do orçamento que dispara o alerta. */
export const BUDGET_ALERT_RATIO = 0.8

export interface CostEntry {
  organizationId: string
  category: CostCategory
  provider: string
  units: number
  unitType: string
  costUsd: number
  refType: string
  refId: string
}

export interface BudgetLogger {
  warn(obj: Record<string, unknown>, msg: string): void
}

export interface BudgetStatus {
  spentUsd: number
  budgetUsd: number
  alert: boolean
  blocked: boolean
}

export interface BudgetService {
  budgetStatus(actor: Actor, orgId: string): Promise<BudgetStatus>
}

function monthRange(now: Date): { gte: Date; lt: Date } {
  const y = now.getUTCFullYear()
  const m = now.getUTCMonth()
  return { gte: new Date(Date.UTC(y, m, 1)), lt: new Date(Date.UTC(y, m + 1, 1)) }
}

/** Arredonda a 6 casas (precisão de `CostLedger.costUsd`) para comparar sem ruído de float. */
function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6
}

function isAlert(spent: number, budget: number): boolean {
  return budget > 0 ? spent >= BUDGET_ALERT_RATIO * budget : spent > 0
}

/** Gasto de IA da organização no mês-calendário UTC de `now`. */
export async function monthSpendUsd(db: DbOrTx, orgId: string, now = new Date()): Promise<number> {
  const agg = await db.costLedger.aggregate({
    where: { organizationId: orgId, occurredAt: monthRange(now) },
    _sum: { costUsd: true },
  })
  return round6(agg._sum.costUsd?.toNumber() ?? 0)
}

async function budgetOf(db: DbOrTx, orgId: string): Promise<number> {
  const org = await db.organization.findUnique({
    where: { id: orgId },
    select: { aiMonthlyBudgetUsd: true },
  })
  if (!org) throw new NotFoundError('Organização não encontrada.')
  return org.aiMonthlyBudgetUsd.toNumber()
}

/** Uma nova análise só começa se a estimativa couber no saldo do mês. */
export async function checkBudget(
  db: DbOrTx,
  orgId: string,
  estimateUsd: number,
  now = new Date(),
): Promise<{ allowed: boolean; spentUsd: number; budgetUsd: number }> {
  const [spentUsd, budgetUsd] = await Promise.all([
    monthSpendUsd(db, orgId, now),
    budgetOf(db, orgId),
  ])
  return { allowed: round6(spentUsd + estimateUsd) <= budgetUsd, spentUsd, budgetUsd }
}

/**
 * Lança um custo no `CostLedger`. Repetir o mesmo `(refType, refId, unitType)` (retry de job)
 * não duplica. Ao cruzar 80% do orçamento grava um único `budget.alert` por mês.
 */
export async function recordCost(
  db: DbOrTx,
  entry: CostEntry,
  opts: { logger?: BudgetLogger } = {},
): Promise<void> {
  try {
    await db.costLedger.create({ data: entry })
  } catch (err) {
    if (!isUniqueViolation(err)) throw err
  }

  const maybeAlert = async (tx: DbOrTx): Promise<void> => {
    // Serializa o alerta por organização: dois lançamentos simultâneos não gravam dois alertas.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`budget.alert:${entry.organizationId}`}))`
    const now = new Date()
    const spentUsd = await monthSpendUsd(tx, entry.organizationId, now)
    const budgetUsd = await budgetOf(tx, entry.organizationId)
    if (!isAlert(spentUsd, budgetUsd)) return
    const already = await tx.auditLog.count({
      where: {
        organizationId: entry.organizationId,
        action: 'budget.alert',
        at: monthRange(now),
      },
    })
    if (already > 0) return
    await writeAudit(tx, {
      action: 'budget.alert',
      entityType: 'organization',
      entityId: entry.organizationId,
      organizationId: entry.organizationId,
      diff: { spentUsd, budgetUsd },
    })
    opts.logger?.warn(
      { organizationId: entry.organizationId, spentUsd, budgetUsd },
      'orçamento mensal de IA passou de 80%',
    )
  }

  // Dentro da transação do chamador usa a mesma; senão abre uma para o lock valer.
  if ('$transaction' in db) await (db as Db).$transaction((tx) => maybeAlert(tx))
  else await maybeAlert(db)
}

export function createBudgetService(deps: { db: Db }): BudgetService {
  const { db } = deps
  return {
    async budgetStatus(actor, orgId) {
      await requireOrgAccess(db, actor, orgId, 'library.read')
      const [spentUsd, budgetUsd] = await Promise.all([
        monthSpendUsd(db, orgId),
        budgetOf(db, orgId),
      ])
      return {
        spentUsd,
        budgetUsd,
        alert: isAlert(spentUsd, budgetUsd),
        blocked: spentUsd >= budgetUsd,
      }
    },
  }
}
