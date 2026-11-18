import { z } from 'zod'
import { defineApiHandler, paramsValidated, readValidated } from '../../../../../utils/errors'
import { discoverPagesOrThrow, requireMetaManage } from '../../../../../utils/meta'

const Params = z.object({ orgId: z.uuid() })
const Body = z.object({ token: z.string().min(1).max(4096) })

// Devolve as Páginas visíveis ao token, sem os Page tokens (que nunca saem pela API).
export default defineApiHandler(async (event) => {
  const { orgId } = paramsValidated(event, Params)
  const { graph } = await requireMetaManage(event, orgId)
  const { token } = await readValidated(event, Body)
  const pages = await discoverPagesOrThrow(graph, token)
  return {
    pages: pages.map(({ pageId, pageName, instagram }) => ({ pageId, pageName, instagram })),
  }
})
