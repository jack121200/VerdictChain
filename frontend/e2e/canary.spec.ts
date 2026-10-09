// No-bluff canary: what the console shows is what the API says, no invented claim appears on any page, and a
// metric with no data shows an em dash with its reason, never a zero.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fleet, injectAndWait, ok, percent, resetState } from './support/api'
import { expect, gotoRoute, sessionAs, test } from './support/fixtures'

const ROUTES = ['dashboard', 'investigations', 'trust', 'debate', 'fleet', 'audit', 'access', 'overview']

/** The claims the no-bluff checker forbids in source (scripts/no-bluff-check.mjs), minus bare numbers, which can
 * be real values on screen. The same list is used here against the rendered text of every page. */
function forbiddenClaims(): string[] {
  const here = fileURLToPath(new URL('.', import.meta.url))
  const script = readFileSync(join(here, '..', 'scripts', 'no-bluff-check.mjs'), 'utf8')
  const start = script.indexOf('const BLACKLIST = [')
  const end = script.indexOf('];', start)
  const items = [...script.slice(start, end).matchAll(/'([^']+)'/g)].map((match) => match[1])
  return items.filter((item) => !/^[0-9. ]+[a-z/]*$/.test(item))
}

/** True when `term` occurs as a whole token (not inside a longer word or identifier). */
function occursAsToken(text: string, term: string): boolean {
  const isWord = (character: string | undefined) => character !== undefined && /[A-Za-z0-9_-]/.test(character)
  let from = 0
  for (;;) {
    const at = text.indexOf(term, from)
    if (at === -1) return false
    if (!isWord(text[at - 1]) && !isWord(text[at + term.length])) return true
    from = at + 1
  }
}

test('the claims list is the real one', () => {
  const claims = forbiddenClaims()
  expect(claims.length).toBeGreaterThan(20)
  expect(claims).toContain('Merkle')
  expect(claims).toContain('Ed25519')
  expect(claims).not.toContain('99.82')
})

test('the numbers on the dashboard and fleet pages are the numbers the API returns', async ({ browser, users }) => {
  await resetState('seed')
  await injectAndWait(users.analyst.token)

  const stats = await ok(users.analyst.token, 'GET', '/stats')
  const agents = await fleet(users.analyst.token)
  const context = await sessionAs(browser, 'analyst')
  const page = await context.newPage()

  await gotoRoute(page, 'dashboard')
  const main = page.getByRole('main')
  await expect(main.getByText(percent(stats.mean_crs.value)).first()).toBeVisible()
  await expect(main.getByText(String(stats.self_healing.actions_total.value), { exact: true }).first()).toBeVisible()

  await gotoRoute(page, 'fleet')
  for (const agent of agents) {
    await expect(page.getByRole('main').getByText(percent(agent.crs.value)).first()).toBeVisible()
  }
  await context.close()
})

test('no invented claim appears on any page', async ({ browser, users }) => {
  await resetState('seed')
  await injectAndWait(users.analyst.token)
  const claims = forbiddenClaims()
  const context = await sessionAs(browser, 'lead')
  const page = await context.newPage()

  const found: string[] = []
  for (const route of ROUTES) {
    await gotoRoute(page, route)
    await page.waitForTimeout(1200)
    const text = await page.getByRole('main').innerText()
    for (const claim of claims) {
      if (occursAsToken(text, claim)) found.push(`${route}: "${claim}"`)
    }
  }
  expect(found, 'forbidden claims in the rendered pages').toEqual([])
  await context.close()
})

test('a metric with no data shows an em dash and its reason, never a zero', async ({ browser, users }) => {
  await resetState('empty')
  const evaluation = await ok(users.analyst.token, 'GET', '/evaluation')
  expect(evaluation.accuracy.value).toBeNull()
  expect(evaluation.accuracy.reason).toBeTruthy()

  const context = await sessionAs(browser, 'analyst')
  const page = await context.newPage()
  await gotoRoute(page, 'overview')
  await expect(page.getByRole('main').getByText(evaluation.accuracy.reason).first()).toBeVisible()
  await expect(page.getByRole('main').getByText('—').first()).toBeVisible()
  await context.close()
  await resetState('seed')
})
