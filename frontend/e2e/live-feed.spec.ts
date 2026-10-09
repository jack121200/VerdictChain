// Live feed: nobody injects anything. A lead starts the simulated feed, rows arrive through RabbitMQ, the monitor
// flags a window, an investigation starts by itself, the debate queue runs it with the offline stub, and the
// Live page shows every step with the API's own numbers. The ground-truth label never reaches the page.
import { STORAGE, auditEntries, call, getInvestigation, loadUsers, ok, resetState } from './support/api'
import { seedRows } from './support/stack.mjs'
import { expect, gotoRoute, test, visibleText, watchHealth } from './support/fixtures'

test.use({ storageState: STORAGE.lead })

test.beforeAll(async () => {
  await resetState('empty')
  seedRows('seed-live')
})

test.afterAll(async () => {
  // Never leave the feed running for the next spec, whatever happened in this one.
  await call(loadUsers().lead.token, 'POST', '/live/stop')
  await resetState('seed')
})

test('a lead starts the feed and an investigation runs by itself, with the live numbers on screen', async ({ page, users }) => {
  const { lead } = users
  const watch = watchHealth(page)

  await gotoRoute(page, 'live')
  await expect(page.getByRole('heading', { name: 'Live feed', level: 1 })).toBeVisible()
  await expect(page.getByText(/No real network is monitored/)).toBeVisible()
  await expect(page.getByText(/Stopped/)).toBeVisible()
  expect((await ok(lead.token, 'GET', '/system/status')).continuous_mode).toBe(false)

  // ---- start it from the page ------------------------------------------------------------------------
  await page.getByLabel('Replay speed').selectOption('25')
  await page.getByRole('button', { name: 'Start live feed' }).click()
  await expect(page.getByText(/Running/)).toBeVisible()
  expect((await ok(lead.token, 'GET', '/system/status')).continuous_mode).toBe(true)

  // ---- rows arrive on their own; a flagged window becomes an investigation with no click ----------------
  await expect
    .poll(async () => (await ok(lead.token, 'GET', '/live/status')).triggered.value, { timeout: 60_000 })
    .toBeGreaterThanOrEqual(1)
  const status = await ok(lead.token, 'GET', '/live/status')
  const investigationId = status.last_trigger.investigation_id as string
  expect(status.last_trigger.reason).toContain('logon window')
  expect(status.consumed.value).toBeGreaterThan(0)

  const started = page.getByRole('region', { name: 'Automatic investigations' })
  await expect(started.getByRole('link', { name: investigationId.slice(0, 8) })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('region', { name: 'Arrivals' }).getByRole('table')).toBeVisible()
  await expect(page.getByRole('region', { name: 'Monitor windows' }).getByText('CERT r4.2 logons')).toBeVisible()

  // ---- the debate queue runs it to a verdict; the API says what the page says ----------------------------
  await expect
    .poll(async () => (await getInvestigation(lead.token, investigationId)).status, { timeout: 60_000 })
    .toMatch(/verdict_reached|contained|ambiguous/)
  const detail = await getInvestigation(lead.token, investigationId)
  expect(detail.rounds_complete).toBe(3)
  expect(detail.primary_agent).toBe('endpoint_behavior')
  await expect(started.getByText(/Verdict reached|Contained|Ambiguous/).first()).toBeVisible({ timeout: 30_000 })

  // ---- open the debate room: the label of the window is nowhere on screen -------------------------------
  await page.goto(`${page.url().split('#')[0]}#/debate/${investigationId}`)
  await expect(page.getByRole('heading', { name: 'Verdict aggregator' })).toBeVisible()
  expect(await visibleText(page)).not.toMatch(/insider_scenario/)
  const apiText = JSON.stringify(detail) + JSON.stringify(status)
  expect(apiText).not.toMatch(/insider_scenario/)

  // ---- stop it from the page; both changes are audited with the analyst -------------------------------
  await gotoRoute(page, 'live')
  await page.getByRole('button', { name: 'Stop live feed' }).click()
  await expect(page.getByText(/Stopped/)).toBeVisible()
  expect((await ok(lead.token, 'GET', '/live/status')).state).toBe('stopped')
  expect((await ok(lead.token, 'GET', '/system/status')).continuous_mode).toBe(false)
  const actions = (await auditEntries(lead.token)).map((entry) => `${entry.action}:${entry.actor}`)
  expect(actions).toContain(`live_feed_started:${lead.username}`)
  expect(actions).toContain(`live_feed_stopped:${lead.username}`)
  expect(actions.some((entry) => entry.startsWith('debate_started:debate_queue'))).toBe(true)

  expect(watch.problems).toEqual([])
})

test('an analyst can watch the feed but has no controls', async ({ browser, users }) => {
  const { analyst } = users
  const context = await browser.newContext({ storageState: STORAGE.analyst, viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  await gotoRoute(page, 'live')
  await expect(page.getByRole('heading', { name: 'Live feed', level: 1 })).toBeVisible()
  await expect(page.getByText(/Stopped/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Start live feed' })).toHaveCount(0)

  const denied = await call(analyst.token, 'POST', '/live/start', {})
  expect(denied.status).toBe(403)
  expect(denied.body.detail).toBe('Missing capability: control_live_feed')
  await context.close()
})
