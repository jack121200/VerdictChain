// Inject flow: Dashboard "Inject simulation stream" -> scenario modal (DDoS) -> Debate Room -> three rounds
// complete -> verdict -> simulated self-healing actions -> the new entries in the Audit Trail. Also proves
// that no real LLM provider was configured or used: every provider label is a stub-* label and the stub's
// own call counter moved.
import { STORAGE, auditEntries, call, getInvestigation, ok, resetState, stubCalls } from './support/api'
import { WEB_URL } from './support/stack.mjs'
import { expect, gotoRoute, test, watchHealth } from './support/fixtures'

test.use({ storageState: STORAGE.analyst })

test.beforeAll(async () => {
  await resetState('seed')
})

test('inject DDoS from the dashboard and follow it to a verdict, simulated containment and the audit trail', async ({
  page,
  users,
}) => {
  const { analyst } = users
  const watch = watchHealth(page)

  // ---- no real provider is configured; the stub's counter is the baseline -------------------------------
  const status = await ok(analyst.token, 'GET', '/system/status')
  expect(status.providers.groq.configured, 'groq key must be blank in the E2E stack').toBe(false)
  expect(status.providers.gemini.configured, 'gemini key must be blank in the E2E stack').toBe(false)
  const callsBefore = await stubCalls()

  // ---- dashboard: pick DDoS, open the modal through "Inject simulation stream" -------------------------
  await gotoRoute(page, 'dashboard')
  await page.getByRole('combobox', { name: 'Attack dataset scenario' }).selectOption('DDoS')
  await page.getByRole('button', { name: 'Inject simulation stream', exact: true }).click()

  const modal = page.getByRole('dialog', { name: /inject simulated threat scenario/i })
  await expect(modal).toBeVisible()
  await expect(modal.getByRole('radio', { name: /DDoS/ })).toBeChecked()
  await modal.getByRole('button', { name: 'Authorize injection', exact: true }).click()

  // ---- it lands on the debate room of the investigation the server created ------------------------------
  await expect(page).toHaveURL(/#\/debate\/[0-9a-f-]{36}$/)
  const investigationId = page.url().split('/').pop() as string
  const main = page.getByRole('main')

  // Live phase: the page the analyst is watching while the debate runs in the background (wait=false).
  // Soft, so a defect in the live path is reported without hiding the stored-transcript checks below.
  for (const round of [1, 2, 3]) {
    await expect.soft(main.getByText(new RegExp(`Round ${round}[ ]*:[ ]*complete`)), `live round ${round}`).toBeVisible({
      timeout: 20_000,
    })
  }
  await expect.soft(page.getByRole('heading', { name: 'Verdict aggregator' }), 'live verdict').toBeVisible()

  // Stored phase: a reload replays the stored transcript of the finished investigation.
  await page.reload()
  await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible()
  for (const round of [1, 2, 3]) {
    await expect(main.getByText(new RegExp(`Round ${round}[ ]*:[ ]*complete`))).toBeVisible()
  }

  // ---- a verdict, as the API computed it ---------------------------------------------------------------
  const detail = await getInvestigation(analyst.token, investigationId)
  expect(detail.verdict_class).toBe('ddos')
  expect(detail.rounds_complete).toBe(3)
  await expect(main.getByRole('heading', { name: 'Verdict aggregator' })).toBeVisible()
  await expect(main.getByText(/class ddos/)).toBeVisible()
  await expect(main.getByText(new RegExp(`status ${detail.status}`))).toBeVisible()

  // ---- self-healing actions: listed, and every one says "simulated" ------------------------------------
  expect(detail.actions.length).toBeGreaterThan(0)
  expect(detail.actions.every((action: { is_simulated: boolean }) => action.is_simulated)).toBe(true)
  await expect(main.getByText(/Self-healing sandbox actions/i)).toBeVisible()
  await expect(main.getByText(/^executed$/i)).toBeVisible()
  for (const action of detail.actions as Array<{ action_type: string; target: string }>) {
    const row = main.getByText(new RegExp(`${action.action_type}\\s*→\\s*${action.target.replace(/\./g, '\\.')}`))
    await expect(row.first()).toBeVisible()
  }
  await expect(main.getByText('simulated', { exact: true })).toHaveCount(detail.actions.length)
  await expect(main.getByText('NOT simulated')).toHaveCount(0)

  // ---- the provider labels are stub labels, on the page and in the API -------------------------------
  await expect(main.getByText(/Engine:\s*stub-/)).toBeVisible()
  const debateText = await main.innerText()
  expect(debateText).not.toMatch(/(?<![\w-])(groq|gemini)(?![\w-])/i)
  const providers = new Set<string>(detail.debate.map((turn: { provider: string }) => turn.provider))
  expect(providers.size).toBeGreaterThan(0)
  for (const provider of providers) expect(provider, 'provider label of a transcript row').toMatch(/^stub-/)

  // ---- the stub served every model call, no real provider was used ------------------------------------
  const callsAfter = await stubCalls()
  const moved = callsAfter.groq + callsAfter.gemini - (callsBefore.groq + callsBefore.gemini)
  expect(moved, 'stubbed complete() calls made by this debate (3 agents x 3 rounds at least)').toBeGreaterThanOrEqual(9)
  const statusAfter = await ok(analyst.token, 'GET', '/system/status')
  expect(statusAfter.providers.groq.calls_24h.value, 'real groq calls').toBe(0)
  expect(statusAfter.providers.gemini.calls_24h.value, 'real gemini calls').toBe(0)

  // ---- the audit trail shows the new entries ----------------------------------------------------------
  const mine = (await auditEntries(analyst.token)).filter((entry) => entry.investigation_id === investigationId)
  const actions = new Set<string>(mine.map((entry) => entry.action))
  for (const expected of ['investigation_started', 'round_completed', 'verdict_reached', 'credibility_update']) {
    expect(actions, `audit actions of ${investigationId}`).toContain(expected)
  }
  await page.goto(`${WEB_URL}/#/audit`)
  await expect(page.getByRole('heading', { level: 1, name: /audit/i })).toBeVisible()
  const humanize = (action: string) =>
    action.replace(/^release:/, 'release ').split('_').map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
  for (const action of ['verdict_reached', 'investigation_started', 'trigger_rate_limiting']) {
    if (!actions.has(action)) continue
    await expect(page.getByRole('heading', { level: 3, name: humanize(action), exact: true }).first()).toBeVisible()
  }
  // The entries are tied to this investigation by its short id, and the chain head is the API's.
  await expect(page.getByText(investigationId.slice(0, 8)).first()).toBeVisible()
  const head = Math.max(...(await auditEntries(analyst.token, 5)).map((entry) => entry.seq))
  await expect(page.getByText('Chain head', { exact: true })).toBeVisible()
  await expect(page.getByText(`#${head}`, { exact: true }).first()).toBeVisible()

  // ---- the whole flow ran without a console error, a page error or an HTTP error ------------------------
  // Soft: every functional assertion above has already been made, so a failure here is reported on its own.
  await watch.settled()
  expect.soft(watch.problems, 'console errors, page errors and HTTP >= 400 during the flow').toEqual([])

  // The same flow is rejected for a caller without a token: the injection is a real, authenticated action.
  expect((await call(null, 'POST', '/investigations/simulate', { scenario_label: 'DDoS' })).status).toBe(401)

})
