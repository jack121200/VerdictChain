// Hallucination drill, end to end through the browser: an agent that cites wrong values is scored by the real
// Watchdog, isolated when round 3 is scored, left out of the verdict, shown as quarantined on every page that
// shows agents, and restored by an analyst whose role allows it (and by nobody else).
import { auditEntries, fleet, getInvestigation, injectAndWait, ok, resetState, setFabricate } from './support/api'
import { expect, gotoRoute, sessionAs, test, watchHealth } from './support/fixtures'

test.beforeAll(async () => {
  await resetState('seed')
})

test.afterAll(async () => {
  await setFabricate([]) // never leave the stub fabricating for the next spec
})

test('a hallucinating agent is isolated, shown as quarantined everywhere, then restored by a lead', async ({
  browser,
  users,
}) => {
  const { analyst, lead } = users

  // ---- one debate with access_log citing wrong values (a fresh agent starts at CrS 0.5: 0.4, 0.32, 0.256) ----
  await setFabricate(['access_log'])
  const investigationId = await injectAndWait(analyst.token)
  await setFabricate([])

  const agents = await fleet(analyst.token)
  const bad = agents.find((agent) => agent.agent_id === 'access_log')
  expect(bad.isolated).toBe(true)
  expect(bad.crs.value).toBeCloseTo(0.256, 3)
  for (const agent of agents.filter((entry) => entry.agent_id !== 'access_log')) expect(agent.isolated).toBe(false)

  const detail = await getInvestigation(analyst.token, investigationId)
  const votes: Array<{ agent_id: string; counted: boolean }> = detail.votes
  expect(votes.find((vote) => vote.agent_id === 'access_log')?.counted).toBe(false)
  expect(votes.filter((vote) => vote.agent_id !== 'access_log').every((vote) => vote.counted)).toBe(true)
  expect(detail.rounds_complete).toBe(3)

  // ---- the analyst's browser: Fleet, Debate Room, Trust, Audit all say so ----------------------------------
  const analystContext = await sessionAs(browser, 'analyst')
  const page = await analystContext.newPage()
  const watch = watchHealth(page)

  await gotoRoute(page, 'fleet')
  await expect(page.getByText(/^quarantined$/i).first()).toBeVisible()
  // A forensic analyst has no quarantine_agent capability: no restore control is offered.
  await page.getByRole('button', { name: 'Select Access-Log Investigator' }).click()
  await expect(page.getByRole('button', { name: 'Restore agent' })).toHaveCount(0)

  await gotoRoute(page, `debate/${investigationId}`)
  await expect(page.getByText(/not counted · isolated/i)).toBeVisible()

  await gotoRoute(page, 'trust')
  await expect(page.getByText(/^quarantined$/i).first()).toBeVisible()
  await expect(page.getByText('value_mismatch').first()).toBeVisible()

  await gotoRoute(page, 'audit')
  await expect(page.getByRole('heading', { level: 3, name: 'Agent Isolated', exact: true }).first()).toBeVisible()

  await watch.settled()
  expect.soft(watch.problems, 'console errors, page errors and HTTP >= 400').toEqual([])
  await analystContext.close()

  // ---- a lead restores the agent from the Fleet page (audited), CrS goes back to the starting value ----------
  const leadContext = await sessionAs(browser, 'lead')
  const leadPage = await leadContext.newPage()
  await gotoRoute(leadPage, 'fleet')
  await leadPage.getByRole('button', { name: 'Select Access-Log Investigator' }).click()
  await leadPage.getByRole('textbox', { name: 'Restore note' }).fill('drill over')
  await leadPage.getByRole('button', { name: 'Restore agent' }).click()
  await expect(leadPage.getByText(/restored to the active fleet/i)).toBeVisible()
  await leadContext.close()

  const after = (await fleet(lead.token)).find((agent) => agent.agent_id === 'access_log')
  expect(after.isolated).toBe(false)
  expect(after.crs.value).toBe(0.5)
  const actions = (await auditEntries(lead.token)).map((entry) => entry.action)
  expect(actions).toContain('agent_isolated')
  expect(actions).toContain('agent_restored')
  const verify = await ok(lead.token, 'POST', '/audit-trail/verify')
  expect(verify.chain_valid).toBe(true)
})
