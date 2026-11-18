import { z } from 'zod'

/** Espelha `RightsInput` do core; a validação de negócio por categoria é do serviço. */
export const RightsBody = z
  .object({
    basis: z.enum(['own', 'authorized', 'cc_license', 'clipper_program', 'none']),
    accepted: z.boolean().optional(),
    creatorName: z.string().max(200).optional(),
    evidenceUrl: z.string().max(2000).optional(),
    evidenceKey: z.string().max(300).optional(),
    licenseType: z.string().max(200).optional(),
    sourceUrl: z.string().max(2000).optional(),
    programUrl: z.string().max(2000).optional(),
    partnerCreatorId: z.uuid().optional(),
  })
  .strict()

export const ParamsBody = z
  .object({
    targetMin: z.number().int().min(1).max(20),
    targetMax: z.number().int().min(1).max(20),
    minSec: z.number().int().min(3).max(180),
    maxSec: z.number().int().min(3).max(180),
    language: z.string().min(2).max(35),
  })
  .partial()
  .strict()
  .refine(
    (p) => p.targetMin === undefined || p.targetMax === undefined || p.targetMin <= p.targetMax,
    {
      message: 'targetMin deve ser menor ou igual a targetMax',
    },
  )
  .refine((p) => p.minSec === undefined || p.maxSec === undefined || p.minSec < p.maxSec, {
    message: 'minSec deve ser menor que maxSec',
  })
