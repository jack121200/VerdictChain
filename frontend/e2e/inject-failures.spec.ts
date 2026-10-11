// Failure paths of "inject a scenario", end to end through the browser. Each one drives a real refusal or a real
// failure and checks what an analyst sees: the server's own sentence, a dialog that stays open, no navigation and no
// investigation created (for a refusal); a banner, a stopped round and a stored reason (for a debate that fails);
// and a Debate Room that keeps following a running debate when the live socket cannot be opened.
import type { Locator, Page } from '@playwright/test'
import {
  STORAGE,
  auditEntries,
  fillDailyCap,
  getInvestigation,
  listInvestigations,
  ok,
  resetState,
  setQuotaExhausted,
} from './support/api'
import { expect, gotoRoute, test } from './support/fixtures'

test.use({ storageState: STORAGE.analyst })

test.beforeEach(async () => {
  await resetState('seed')
})

test.afterAll(async () => {
  await setQuotaExhausted(false) // never leave the stub failing for the next spec
})

/** The dashboard with the inject dialog open on `scenario`. */
async function openDialog(page: Page, scenario = 'DDoS'): Promise<Locator> {
  await gotoRoute(page, 'dashboard')
  await page.getByRole('combobox', { name: 'Attack dataset scenario' }).selectOption(scenario)
  await page.getByRole('button', { name: 'Inject simulation stream', exact: true }).click()
  const modal = page.getByRole('dialog', { name: /inject simulated threat scenario/i })
  await expect(modal).toBeVisible()
  return modal
}

const authorize = (modal: Locator) => modal.getByRole('button', { name: 'Authorize injection', exact: true }).click()

/** The refusal as the analyst sees it: the server's sentence in the dialog, the dialog still open, no navigation. */
async function expectRefusal(page: Page, modal: Locator, sentence: RegExp): Promise<void> {
  await authorize(modal)
  await expect(modal.getByRole('alert')).toContainText(sentence)
  await expect(modal).toBeVisible()
  await expect(page).toHaveURL(/#\/dashboard$/)
}

const SETTINGS_FIELDS = ['eta', 'isolation_threshold', 'verdict_confidence_threshold'] as const

async function setIntakePaused(leadToken: string, paused: boolean): Promise<void> {
  const settings = await ok(leadToken, 'GET', '/settings')
  const body: Record<string, unknown> = { intake_paused: paused }
  for (const field of SETTINGS_FIELDS) body[field] = settings[field]
  await ok(leadToken, 'PUT', '/settings', body)
}

test('a paused intake refuses the injection with the server\'s sentence, and nothing is created', async ({ page, users }) => {
  await setIntakePaused(users.lead.token, true)
  try {
    const before = (await listInvestigations(users.analyst.token)).length
    const modal = await openDialog(page)

    await expectRefusal(page, modal, /Intake is paused/)
    expect(await listInvestigations(users.analyst.token)).toHaveLength(before)
  } finally {
    await setIntakePaused(users.lead.token, false)
  }
})

test('a filled daily cap refuses the injection and says it is the analyst\'s own limit', async ({ page, users }) => {
  fillDailyCap(users.analyst.username)
  const before = (await listInvestigations(users.analyst.token)).length
  const modal = await openDialog(page)

  await expectRefusal(page, modal, /Daily debate limit reached for this analyst/)
  expect(await listInvestigations(users.analyst.token)).toHaveLength(before)
})

test('with fewer than two investigators active the injection is refused and says how to fix it', async ({ page, users }) => {
  for (const agent of ['network_traffic', 'access_log']) {
    await ok(users.lead.token, 'POST', `/agents/${agent}/quarantine`, { reason: 'e2e: too few active investigators' })
  }
  const modal = await openDialog(page)

  await expectRefusal(page, modal, /Fewer than 2 investigator agents are active\. Restore a quarantined agent first\./)
  expect(await listInvestigations(users.analyst.token)).toHaveLength(0)
})

test('a scenario with no rows in the database is refused by name', async ({ page, users }) => {
  await resetState('empty') // raw_logs is empty: every scenario has zero rows
  const modal = await openDialog(page)

  await expectRefusal(page, modal, /No rows for scenario 'DDoS'/)
  expect(await listInvestigations(users.analyst.token)).toHaveLength(0)
})

test('a debate the model cannot answer stops with its reason in plain words, on the page, in the list and in the audit trail', async ({
  page,
  users,
}) => {
  await setQuotaExhausted(true)
  const modal = await openDialog(page)
  await authorize(modal)

  // The injection itself is accepted (202): the failure happens in the background, and the room shows it.
  await expect(page).toHaveURL(/#\/debate\/[0-9a-f-]{36}$/)
  const investigationId = page.url().split('/').pop() as string
  const main = page.getByRole('main')

  await expect(main.getByText('This debate stopped before a verdict')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('failure-reason')).toContainText('The openai account has no quota or credit left')
  await expect(main.getByText(/Round 1[ ]*:[ ]*stopped/)).toBeVisible() // the cut-off round, never "complete"
  await expect(main.getByText('no quorum: the debate stopped')).toBeVisible()
  await expect(main.getByText('No verdict: the debate stopped').first()).toBeVisible()
  await expect(main.getByText('Adjudication in progress')).toHaveCount(0)

  // What is stored: status error, the same sentence, and the audit entry that carries it.
  const detail = await getInvestigation(users.analyst.token, investigationId)
  expect(detail.status).toBe('error')
  expect(detail.error_reason).toMatch(/no quota or credit left/)
  expect(detail.actions).toEqual([]) // nothing was contained
  const failures = (await auditEntries(users.analyst.token)).filter(
    (entry) => entry.investigation_id === investigationId && entry.action === 'investigation_failed',
  )
  expect(failures).toHaveLength(1)
  expect(failures[0].detail.reason).toBe(detail.error_reason)

  // The case list says why too, not just "failed".
  await gotoRoute(page, `investigations/${investigationId}`)
  await expect(page.getByText(/Stopped: The openai account has no quota or credit left/).first()).toBeVisible()

  // The quota comes back: the very next injection runs to a verdict.
  await setQuotaExhausted(false)
  const modalAgain = await openDialog(page)
  await authorize(modalAgain)
  await expect(page).toHaveURL(/#\/debate\/[0-9a-f-]{36}$/)
  await expect(page.getByRole('main').getByText(/Round 3[ ]*:[ ]*complete/)).toBeVisible({ timeout: 40_000 })
})

test('with the live socket unavailable the Debate Room still follows a running debate to its verdict, by itself', async ({
  page,
}) => {
  // The ticket every WebSocket needs is refused: the room has no live channel at all.
  await page.route('**/auth/ws-ticket', (route) =>
    route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ detail: 'ticket service down' }) }),
  )
  const pageErrors: string[] = []
  const sockets: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('websocket', (socket) => sockets.push(socket.url()))

  const modal = await openDialog(page)
  await authorize(modal)
  await expect(page).toHaveURL(/#\/debate\/[0-9a-f-]{36}$/)

  // No reload by the test: the room reads the stored case again on its own (every few seconds) and reaches the verdict.
  const main = page.getByRole('main')
  await expect(main.getByText(/Round 3[ ]*:[ ]*complete/)).toBeVisible({ timeout: 45_000 })
  await expect(main.getByRole('heading', { name: 'Verdict aggregator' })).toBeVisible()
  await expect(main.getByText('This debate stopped before a verdict')).toHaveCount(0)
  expect(pageErrors, 'page errors while the socket was unavailable').toEqual([])
  // It really was the stored data that got it there: no investigation socket was ever opened.
  expect(sockets.filter((url) => url.includes('/ws/investigations/')), 'investigation sockets opened').toEqual([])
})
