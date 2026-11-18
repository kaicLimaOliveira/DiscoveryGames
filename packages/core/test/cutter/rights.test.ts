import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startTestDatabase } from '@central/db/testing'
import { ForbiddenError, NotFoundError, ValidationError } from '../../src/errors.js'
import { assertPublishable, validateRights } from '../../src/cutter/rights.js'

let db: Awaited<ReturnType<typeof startTestDatabase>> | undefined

beforeAll(async () => {
  db = await startTestDatabase()
}, 120_000)
afterAll(() => db?.stop())

const msg = (fn: () => unknown): string => {
  try {
    fn()
  } catch (e) {
    expect(e).toBeInstanceOf(ValidationError)
    return (e as Error).message
  }
  throw new Error('não lançou')
}

describe('validateRights', () => {
  it('own exige aceite explícito', () => {
    expect(validateRights({ basis: 'own', accepted: true })).toEqual({
      basis: 'own',
      accepted: true,
    })
    expect(msg(() => validateRights({ basis: 'own' }))).toMatch(/confirme/i)
    expect(() => validateRights({ basis: 'own', accepted: false })).toThrow(ValidationError)
  })

  it('authorized exige nome do criador e evidência (link ou anexo)', () => {
    expect(
      validateRights({
        basis: 'authorized',
        creatorName: ' Fulano ',
        evidenceUrl: 'https://exemplo.com/ok',
      }),
    ).toEqual({ basis: 'authorized', creatorName: 'Fulano', evidenceUrl: 'https://exemplo.com/ok' })
    expect(
      validateRights({ basis: 'authorized', creatorName: 'F', evidenceKey: 'orgs/x/evidence/y' }),
    ).toMatchObject({ evidenceKey: 'orgs/x/evidence/y' })
    expect(() => validateRights({ basis: 'authorized', creatorName: 'F' })).toThrow(ValidationError)
    expect(() =>
      validateRights({ basis: 'authorized', evidenceUrl: 'https://exemplo.com' }),
    ).toThrow(ValidationError)
  })

  it('parceiro com autorização satisfaz authorized e herda nome e evidência', () => {
    const out = validateRights(
      { basis: 'authorized', partnerCreatorId: 'p1' },
      { name: 'Parceiro', authorizationUrl: null, authorizationKey: 'orgs/o/evidence/k' },
    )
    expect(out).toEqual({
      basis: 'authorized',
      partnerCreatorId: 'p1',
      creatorName: 'Parceiro',
      evidenceKey: 'orgs/o/evidence/k',
    })
    const byUrl = validateRights(
      { basis: 'authorized', partnerCreatorId: 'p1' },
      { name: 'Parceiro', authorizationUrl: 'https://doc.com/a', authorizationKey: null },
    )
    expect(byUrl.evidenceUrl).toBe('https://doc.com/a')
  })

  it('parceiro sem autorização não basta', () => {
    expect(() =>
      validateRights(
        { basis: 'authorized', partnerCreatorId: 'p1' },
        { name: 'Parceiro', authorizationUrl: null, authorizationKey: null },
      ),
    ).toThrow(ValidationError)
  })

  it('cc_license exige link da fonte e tipo de licença', () => {
    expect(
      validateRights({
        basis: 'cc_license',
        sourceUrl: 'https://youtube.com/watch?v=x',
        licenseType: 'CC BY 4.0',
      }),
    ).toEqual({
      basis: 'cc_license',
      sourceUrl: 'https://youtube.com/watch?v=x',
      licenseType: 'CC BY 4.0',
    })
    expect(() => validateRights({ basis: 'cc_license', licenseType: 'CC BY' })).toThrow(
      ValidationError,
    )
    expect(() => validateRights({ basis: 'cc_license', sourceUrl: 'https://a.com' })).toThrow(
      ValidationError,
    )
  })

  it('clipper_program exige link do programa', () => {
    expect(
      validateRights({ basis: 'clipper_program', programUrl: 'https://programa.com/regras' }),
    ).toEqual({ basis: 'clipper_program', programUrl: 'https://programa.com/regras' })
    expect(() => validateRights({ basis: 'clipper_program' })).toThrow(ValidationError)
  })

  it('none não exige nada e ignora os demais campos', () => {
    expect(
      validateRights({ basis: 'none', accepted: true, creatorName: 'x', evidenceUrl: 'http://a' }),
    ).toEqual({ basis: 'none' })
  })

  it('URL http: é recusada', () => {
    expect(
      msg(() => validateRights({ basis: 'clipper_program', programUrl: 'http://programa.com' })),
    ).toMatch(/https/)
    expect(() =>
      validateRights({ basis: 'authorized', creatorName: 'F', evidenceUrl: 'javascript:alert(1)' }),
    ).toThrow(ValidationError)
    expect(() =>
      validateRights({ basis: 'cc_license', sourceUrl: 'não é url', licenseType: 'CC' }),
    ).toThrow(ValidationError)
  })

  it('categoria desconhecida é recusada', () => {
    expect(() => validateRights({ basis: 'outra' as never })).toThrow(ValidationError)
  })
})

describe('assertPublishable', () => {
  it('lança para none e passa para own', async () => {
    const p = db!.prisma
    const org = await p.organization.create({ data: { name: 'O', slug: 'o' } })
    const mk = (basis: 'own' | 'none') =>
      p.source.create({
        data: {
          organizationId: org.id,
          kind: 'upload',
          title: 't',
          rightsBasis: basis,
          params: {},
        },
      })
    const none = await mk('none')
    const own = await mk('own')
    await expect(assertPublishable(p, none.id)).rejects.toThrow(
      new ForbiddenError('Fonte sem direitos de publicação.'),
    )
    await expect(assertPublishable(p, own.id)).resolves.toBeUndefined()
    await expect(
      assertPublishable(p, '00000000-0000-7000-8000-000000000000'),
    ).rejects.toBeInstanceOf(NotFoundError)
  })
})
