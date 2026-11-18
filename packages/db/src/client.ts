import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient, type Prisma } from './generated/prisma/client.js'

export type Db = PrismaClient
export type Tx = Prisma.TransactionClient
export type DbOrTx = Db | Tx

export function createPrisma(databaseUrl: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) })
}
