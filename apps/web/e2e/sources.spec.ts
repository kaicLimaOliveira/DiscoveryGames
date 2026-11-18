import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPrisma } from '@central/db'
import { makeVideo } from '@central/media/testing'
import { expect, test, type Page } from '@playwright/test'
import { Secret, TOTP } from 'otpauth'

// Sem worker no E2E: a fonte para em "Na fila" depois do envio.
let tmp: string
let mp4: string
const prisma = createPrisma(process.env.E2E_DATABASE_URL ?? '')

// Um login só para o arquivo: o código TOTP não pode ser reaproveitado entre logins.
const STATE = join(tmpdir(), `central-e2e-state-${process.pid}.json`)
test.use({ storageState: STATE })

test.beforeAll(async ({ browser }) => {
  tmp = await mkdtemp(join(tmpdir(), 'central-e2e-'))
  mp4 = await makeVideo(tmp, { seconds: 3, audio: 'tone' })
  const context = await browser.newContext({ storageState: undefined })
  await loginAdmin(await context.newPage())
  await context.storageState({ path: STATE })
  await context.close()
})

test.afterAll(async () => {
  await prisma.$disconnect()
  await rm(tmp, { recursive: true, force: true })
  await rm(STATE, { force: true })
})

function code(secret: string, offsetPeriods = 0): string {
  return new TOTP({
    secret: Secret.fromBase32(secret),
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
  }).generate({ timestamp: Date.now() + offsetPeriods * 30_000 })
}

async function hydrated(page: Page): Promise<void> {
  await page.waitForSelector('body[data-hydrated]', { state: 'attached' })
}

async function loginAdmin(page: Page): Promise<void> {
  await page.goto('/login')
  await hydrated(page)
  await page.getByLabel('E-mail').fill(process.env.E2E_ADMIN_EMAIL!)
  await page.getByLabel('Senha').fill(process.env.E2E_ADMIN_PASSWORD!)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page).toHaveURL(/\/2fa$/)
  await hydrated(page)
  // Anti-replay: cada código só vale se o período for maior que o do último login. Outro spec
  // pode ter usado o período seguinte; nesse caso espera a virada do período e tenta de novo.
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.getByLabel('Código de 6 dígitos').fill(code(process.env.E2E_ADMIN_TOTP_SECRET!, 1))
    await page.getByRole('button', { name: 'Verificar' }).click()
    try {
      await expect(page).not.toHaveURL(/\/2fa$/, { timeout: 5_000 })
      return
    } catch (err) {
      if (attempt === 1) throw err
      await page.waitForTimeout(30_000 - (Date.now() % 30_000) + 500)
    }
  }
}

async function seedOrg(name: string): Promise<string> {
  const org = await prisma.organization.create({
    data: { name, slug: `${name.toLowerCase()}-${Date.now()}` },
  })
  return org.id
}

test('envia um MP4 pequeno com direitos "own" e a fonte aparece "Na fila"', async ({ page }) => {
  const orgId = await seedOrg('Upload')
  await page.goto(`/orgs/${orgId}/sources`)
  await hydrated(page)

  await page.getByRole('button', { name: 'Novo corte' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Título').fill('Partida de teste')
  await dialog.locator('input[type=file]').setInputFiles(mp4)
  await dialog.getByLabel('Declaro que o conteúdo é meu').check()
  await dialog.getByRole('button', { name: 'Enviar' }).click()

  const row = page.getByTestId('source-row').filter({ hasText: 'Partida de teste' })
  await expect(row).toBeVisible({ timeout: 30_000 })
  await expect(row.getByText('Na fila')).toBeVisible({ timeout: 30_000 })
})

test('"own" sem marcar a declaração mostra o erro e não envia', async ({ page }) => {
  const orgId = await seedOrg('SemAceite')
  await page.goto(`/orgs/${orgId}/sources`)
  await hydrated(page)

  const posts: string[] = []
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().includes('/sources')) posts.push(r.url())
  })

  await page.getByRole('button', { name: 'Novo corte' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Título').fill('Sem aceite')
  await dialog.locator('input[type=file]').setInputFiles(mp4)
  await dialog.getByRole('button', { name: 'Enviar' }).click()

  await expect(
    dialog.getByText('Confirme que você é dono do vídeo para declarar direitos próprios.'),
  ).toBeVisible()
  expect(posts).toEqual([])
  expect(await prisma.source.count({ where: { organizationId: orgId } })).toBe(0)
})

test('candidatos semeados no banco: aceitar, rejeitar e ajustar para 0:10.0–0:40.0 atualizam o card', async ({
  page,
}) => {
  const orgId = await seedOrg('Candidatos')
  const asset = await prisma.mediaAsset.create({
    data: {
      organizationId: orgId,
      kind: 'original',
      storageKey: `orgs/${orgId}/sources/seed/original.mp4`,
      sha256: 'a'.repeat(64),
      sizeBytes: 1000n,
      mimeType: 'video/mp4',
      probe: {},
      durationMs: 120_000,
      width: 640,
      height: 360,
      hasAudio: true,
    },
  })
  const source = await prisma.source.create({
    data: {
      organizationId: orgId,
      kind: 'upload',
      title: 'Fonte semeada',
      status: 'ready',
      rightsBasis: 'own',
      params: { targetMin: 5, targetMax: 10, minSec: 30, maxSec: 90, language: 'pt-BR' },
      mediaAssetId: asset.id,
    },
  })
  const captions = {
    instagram: { caption: 'Legenda do Instagram' },
    facebook: { caption: 'Legenda do Facebook' },
    tiktok: { caption: 'Legenda do TikTok' },
    youtube: { title: 'Título do YouTube', description: 'Descrição do YouTube' },
  }
  for (const [i, title] of ['Primeiro corte', 'Segundo corte', 'Terceiro corte'].entries()) {
    await prisma.clipCandidate.create({
      data: {
        organizationId: orgId,
        sourceId: source.id,
        rank: i + 1,
        startMs: 5_000 + i * 50_000,
        endMs: 45_000 + i * 50_000,
        suggestedStartMs: 5_000 + i * 50_000,
        suggestedEndMs: 45_000 + i * 50_000,
        hookScore: 90 - i,
        reason: `Motivo ${i + 1}`,
        title,
        captions,
        hashtags: ['games'],
        layout: 'face',
      },
    })
  }

  await page.goto(`/orgs/${orgId}/sources/${source.id}`)
  await hydrated(page)

  const card = (title: string) => page.getByTestId('candidate-card').filter({ hasText: title })

  await card('Primeiro corte').getByRole('button', { name: 'Aceitar' }).click()
  await expect(card('Primeiro corte').getByTestId('candidate-status')).toHaveText('Aceito')

  await card('Segundo corte').getByRole('button', { name: 'Rejeitar' }).click()
  await expect(card('Segundo corte').getByTestId('candidate-status')).toHaveText('Rejeitado')

  const third = card('Terceiro corte')
  await third.getByRole('button', { name: 'Ajustar início/fim' }).click()
  await third.getByLabel('Início (mm:ss.d)').fill('0:10.0')
  await third.getByLabel('Fim (mm:ss.d)').fill('0:40.0')
  await third.getByRole('button', { name: 'Salvar ajuste' }).click()
  await expect(third.getByTestId('candidate-range')).toHaveText('0:10.0 – 0:40.0')

  const saved = await prisma.clipCandidate.findFirstOrThrow({
    where: { sourceId: source.id, title: 'Terceiro corte' },
  })
  expect([saved.startMs, saved.endMs]).toEqual([10_000, 40_000])
})
