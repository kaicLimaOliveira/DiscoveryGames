import { expect, test, type Page } from '@playwright/test'
import { Secret, TOTP } from 'otpauth'

const PASSWORD = 'senha-e2e-forte-123'

function code(secret: string): string {
  return new TOTP({
    secret: Secret.fromBase32(secret),
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
  }).generate()
}

async function login(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login')
  await page.waitForSelector('body[data-hydrated]', { state: 'attached' })
  await page.getByLabel('E-mail').fill(email)
  await page.getByLabel('Senha').fill(password)
  await page.getByRole('button', { name: 'Entrar' }).click()
}

async function createUserViaUi(
  page: Page,
  u: { name: string; email: string; role: string },
): Promise<void> {
  await page.getByRole('button', { name: 'Novo usuário' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Nome').fill(u.name)
  await dialog.getByLabel('E-mail').fill(u.email)
  await dialog.getByLabel('Senha inicial').fill(PASSWORD)
  await dialog.getByLabel('Papel na marca').selectOption(u.role)
  await dialog.getByRole('button', { name: 'Criar' }).click()
  await expect(page.getByTestId('user-row').filter({ hasText: u.email })).toBeVisible()
}

test('fluxo completo: admin, editor sem 2FA e approver com cadastro de 2FA', async ({
  page,
  browser,
}) => {
  const adminEmail = process.env.E2E_ADMIN_EMAIL!
  const adminSecret = process.env.E2E_ADMIN_TOTP_SECRET!

  // 1. Admin com TOTP: login + verificação.
  await login(page, adminEmail, process.env.E2E_ADMIN_PASSWORD!)
  await expect(page).toHaveURL(/\/2fa$/)
  await page.getByLabel('Código de 6 dígitos').fill(code(adminSecret))
  await page.getByRole('button', { name: 'Verificar' }).click()
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByText('Fase 1 — fundação pronta')).toBeVisible()

  // 2. Admin cria editor e approver.
  await page.goto('/admin/users')
  await page.waitForSelector('body[data-hydrated]', { state: 'attached' })
  await createUserViaUi(page, { name: 'Editora', email: 'editor@x.com', role: 'editor' })
  await createUserViaUi(page, { name: 'Aprovador', email: 'approver@x.com', role: 'approver' })

  // 3. Editor: entra direto, sem 2FA, e não acessa /admin/users.
  const editorCtx = await browser.newContext()
  const editorPage = await editorCtx.newPage()
  await login(editorPage, 'editor@x.com', PASSWORD)
  await expect(editorPage).toHaveURL(/\/$/)
  await expect(editorPage.getByText('Fase 1 — fundação pronta')).toBeVisible()
  await editorPage.goto('/admin/users')
  await expect(editorPage).toHaveURL(/\/$/)
  await editorCtx.close()

  // 4. Approver: cadastro obrigatório de 2FA.
  const approverCtx = await browser.newContext()
  const approverPage = await approverCtx.newPage()
  await login(approverPage, 'approver@x.com', PASSWORD)
  await expect(approverPage).toHaveURL(/\/2fa$/)
  const secretEl = approverPage.getByTestId('totp-secret')
  await approverPage.waitForSelector('body[data-hydrated]', { state: 'attached' })
  await expect(secretEl).toBeVisible()
  await expect(approverPage.getByRole('img', { name: 'QR code' })).toBeVisible()
  const secret = (await secretEl.innerText()).replace(/\s+/g, '')
  await approverPage.getByLabel('Código de 6 dígitos').fill(code(secret))
  await approverPage.getByRole('button', { name: 'Confirmar' }).click()
  await expect(approverPage).toHaveURL(/\/$/)
  await expect(approverPage.getByText('Fase 1 — fundação pronta')).toBeVisible()
  await approverCtx.close()
})
