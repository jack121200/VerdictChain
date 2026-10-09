// Role checks, the audit chain checked in the browser, and live updates without a reload.
import { auditEntries, injectAndWait, injectInBackground, ok, resetState } from './support/api'
import { expect, gotoRoute, sessionAs, test } from './support/fixtures'
import { WEB_URL } from './support/stack.mjs'

test.beforeAll(async () => {
  await resetState('seed')
})

test('only a role with sign_evidence_bundle can record a sign-off; a forged token is sent back to login', async ({
  browser,
  users,
}) => {
  const investigationId = await injectAndWait(users.analyst.token)

  // a forensic analyst: the control is there but disabled, and says why
  const analystContext = await sessionAs(browser, 'analyst')
  const analystPage = await analystContext.newPage()
  await gotoRoute(analystPage, `debate/${investigationId}`)
  const disabled = analystPage.getByRole('button', { name: 'Record sign-off (audited)' })
  await expect(disabled).toBeDisabled()
  await expect(analystPage.getByText(/does not grant sign_evidence_bundle/i)).toBeVisible()
  await analystContext.close()

  // a secops lead: enabled, and the click is an audited action
  const leadContext = await sessionAs(browser, 'lead')
  const leadPage = await leadContext.newPage()
  await gotoRoute(leadPage, `debate/${investigationId}`)
  const enabled = leadPage.getByRole('button', { name: 'Record sign-off (audited)' })
  await expect(enabled).toBeEnabled()
  await enabled.click()
  await expect
    .poll(async () => (await auditEntries(users.lead.token)).some((entry) => entry.action === 'evidence_bundle_signed'), {
      timeout: 15_000,
    })
    .toBe(true)
  await leadContext.close()

  // a forged token: the API answers 401, the console clears it and shows the login page
  // The token is in place before the page's first script runs, so the console boots once, with the forged one.
  const forgedContext = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await forgedContext.addInitScript(() => window.localStorage.setItem('verdictchain_token', 'forged.token.value'))
  const forgedPage = await forgedContext.newPage()
  await forgedPage.goto(`${WEB_URL}/#/dashboard`)
  await expect(forgedPage).toHaveURL(/#[/]login/, { timeout: 15_000 })
  expect(await forgedPage.evaluate(() => window.localStorage.getItem('verdictchain_token'))).toBeNull()
  await forgedContext.close()
})

test('the server verifies the audit chain and the browser recomputes an entry hash that matches', async ({
  browser,
  users,
}) => {
  await injectAndWait(users.analyst.token)
  const context = await sessionAs(browser, 'analyst')
  const page = await context.newPage()
  await gotoRoute(page, 'audit')

  await page.getByRole('button', { name: 'Verify cryptographic proof' }).click()
  await expect(page.getByText(/Server verify: [0-9,]+ entries intact/)).toBeVisible({ timeout: 15_000 })
  const verify = await ok(users.analyst.token, 'POST', '/audit-trail/verify')
  expect(verify.chain_valid).toBe(true)

  // the newest entry is selected: its pre-image is hashed in the browser and compared with the stored hash
  await expect(page.getByText('Browser SHA-256 recompute').first()).toBeVisible()
  await expect(page.getByText('Matches entry_hash')).toBeVisible()
  await context.close()
})

test('new audit entries appear in an open page without a reload', async ({ browser, users }) => {
  const context = await sessionAs(browser, 'analyst')
  const page = await context.newPage()
  await gotoRoute(page, 'audit')
  const headBefore = Math.max(...(await auditEntries(users.analyst.token, 5)).map((entry) => entry.seq))
  await expect(page.getByText(`#${headBefore}`, { exact: true }).first()).toBeVisible()

  await injectInBackground(users.analyst.token) // returns at once; the debate runs on the server

  await expect
    .poll(
      async () => {
        const text = await page.getByRole('main').innerText()
        const heads = [...text.matchAll(/seq #([0-9]+)/g)].map((match) => Number(match[1]))
        return Math.max(0, ...heads) > headBefore
      },
      { timeout: 30_000, message: 'a newer audit entry shows up in the open page with no reload' },
    )
    .toBe(true)
  await context.close()
})
