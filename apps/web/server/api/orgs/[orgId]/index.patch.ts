import { z } from 'zod'
import { requireActor } from '../../../utils/auth'
import { defineApiHandler, paramsValidated, readValidated } from '../../../utils/errors'
import { useServices } from '../../../utils/services'

const Params = z.object({ orgId: z.uuid() })
const Body = z
  .object({
    name: z.string(),
    timezone: z.string(),
    locale: z.string(),
    tags: z.array(z.string()),
    voiceGuide: z.string(),
    fixedHashtags: z.array(z.string()),
    creditTemplate: z.string(),
    captionStyle: z.record(z.string(), z.unknown()),
    clipDefaults: z.object({
      targetMin: z.number(),
      targetMax: z.number(),
      minSec: z.number(),
      maxSec: z.number(),
    }),
    aiMonthlyBudgetUsd: z.number(),
  })
  .partial()
  .strict()

// A checagem de papel (settings.manage) e a ocultação de organizações alheias (404) ficam no
// serviço, que conhece a ordem correta: 404 para quem não pertence, 403 para quem pertence sem
// permissão.
export default defineApiHandler(async (event) => {
  const actor = await requireActor(event)
  const { orgId } = paramsValidated(event, Params)
  const patch = await readValidated(event, Body)
  return useServices().organizations.update(actor, orgId, patch)
})
