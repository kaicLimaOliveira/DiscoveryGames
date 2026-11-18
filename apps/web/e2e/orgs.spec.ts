import { expect, test, type Page } from '@playwright/test'
import { Secret, TOTP } from 'otpauth'

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
  // Outro spec pode ter usado o código do período atual: o próximo também é aceito.
  await page.getByLabel('Código de 6 dígitos').fill(code(process.env.E2E_ADMIN_TOTP_SECRET!, 1))
  await page.getByRole('button', { name: 'Verificar' }).click()
  await expect(page).not.toHaveURL(/\/2fa$/)
}

async function createOrg(page: Page, name: string): Promise<void> {
  await page.goto('/orgs')
  await hydrated(page)
  await page.getByRole('button', { name: 'Nova organização' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Nome').fill(name)
  await dialog.getByRole('button', { name: 'Criar' }).click()
  await expect(page).toHaveURL(/\/orgs\/[0-9a-f-]+\/accounts$/)
  await hydrated(page)
}

async function linkTiktok(page: Page, handle: string): Promise<void> {
  await page.getByRole('button', { name: 'TikTok (@)' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Usuário do TikTok').fill(handle)
  await dialog.getByRole('button', { name: 'Vincular' }).click()
}

test('organizações: criar, configurar, vincular TikTok e trocar pelo seletor', async ({ page }) => {
  await loginAdmin(page)

  await createOrg(page, 'GamerDoido')

  await page.getByRole('link', { name: 'Configurações' }).click()
  await expect(page).toHaveURL(/\/orgs\/[0-9a-f-]+\/settings$/)
  await hydrated(page)
  await page.getByLabel('Tags', { exact: true }).fill('#Games, PS5')
  await page.getByLabel('Tags', { exact: true }).press('Enter')
  await page.getByRole('button', { name: 'Salvar' }).click()
  await expect(page.getByText('Configurações salvas.')).toBeVisible()
  await page.reload()
  await hydrated(page)
  await expect(page.getByTestId('tag-chip').filter({ hasText: /^games$/ })).toBeVisible()
  await expect(page.getByTestId('tag-chip').filter({ hasText: /^ps5$/ })).toBeVisible()

  await page.getByRole('link', { name: 'Contas' }).click()
  await expect(page).toHaveURL(/\/accounts$/)
  await hydrated(page)
  await linkTiktok(page, '@GamerDoido')
  await expect(page.getByTestId('account-row').filter({ hasText: '@gamerdoido' })).toBeVisible()

  await createOrg(page, 'Academia')
  await expect(page.getByTestId('account-row')).toHaveCount(0)
  await page.getByLabel('Organização ativa').selectOption({ label: 'GamerDoido' })
  await expect(page.getByTestId('account-row').filter({ hasText: '@gamerdoido' })).toBeVisible()
  await page.getByLabel('Organização ativa').selectOption({ label: 'Academia' })
  await expect(page.getByTestId('account-row')).toHaveCount(0)

  await linkTiktok(page, '@gamerdoido')
  await expect(
    page.getByRole('dialog').getByText('Esta conta já está vinculada a outra organização.'),
  ).toBeVisible()
})
