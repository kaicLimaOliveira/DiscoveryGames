import { ValidationError } from '@central/core'
import { z } from 'zod'
import { defineApiHandler, paramsValidated, readValidated } from '../../../../../utils/errors'
import { discoverPagesOrThrow, requireMetaManage } from '../../../../../utils/meta'
import { useServices } from '../../../../../utils/services'

const Params = z.object({ orgId: z.uuid() })
const Body = z.object({
  token: z.string().min(1).max(4096),
  pageId: z.string().min(1).max(100),
  includeFacebookWithoutInstagram: z.boolean().optional(),
})

export default defineApiHandler(async (event) => {
  const { orgId } = paramsValidated(event, Params)
  const { actor, graph } = await requireMetaManage(event, orgId)
  const { token, pageId, includeFacebookWithoutInstagram } = await readValidated(event, Body)
  // O token não é guardado entre discover e connect: descobre de novo e localiza a Página.
  const pages = await discoverPagesOrThrow(graph, token)
  const page = pages.find((p) => p.pageId === pageId)
  if (!page) throw new ValidationError('Página não encontrada para este token.')
  if (!page.instagram && !includeFacebookWithoutInstagram) {
    throw new ValidationError(
      'Esta Página não tem Instagram vinculado. Confirme para vincular só o Facebook.',
    )
  }
  const credential = { kind: 'meta_page', pageAccessToken: page.pageAccessToken }
  const { db, accounts } = useServices()
  // Mesma transação: um conflito em qualquer conta desfaz as duas.
  const linked = await db.$transaction(async (tx) => {
    const result = [
      await accounts.upsertLinked(
        actor,
        orgId,
        {
          platform: 'facebook',
          externalId: page.pageId,
          displayName: page.pageName,
          credential,
          scopes: [],
        },
        { tx },
      ),
    ]
    if (page.instagram) {
      result.push(
        await accounts.upsertLinked(
          actor,
          orgId,
          {
            platform: 'instagram',
            externalId: page.instagram.id,
            displayName: `@${page.instagram.username}`,
            credential,
            scopes: [],
          },
          { tx },
        ),
      )
    }
    return result
  })
  setResponseStatus(event, 201)
  return { accounts: linked }
})
