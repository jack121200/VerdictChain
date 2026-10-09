// Smoke: sign in through the real login screen, then open every route. Each one must render its main
// content with zero console errors, zero uncaught page errors, zero failed requests and zero API
// responses with a status of 400 or above.
import { injectAndWait, loadUsers, resetState } from './support/api'
import { expect, test, watchHealth } from './support/fixtures'
import { WEB_URL } from './support/stack.mjs'

let investigationId = ''

test.beforeAll(async () => {
  await resetState('seed')
  // One finished investigation, so the detail routes and the data-heavy tables are exercised too.
  investigationId = await injectAndWait(loadUsers().analyst.token)
})

/** What proves each screen rendered: a level-1 heading, or the screen's primary control. */
const ROUTES: ReadonlyArray<{ route: string; ready: (page: import('@playwright/test').Page) => import('@playwright/test').Locator }> = [
  { route: 'dashboard', ready: (page) => page.getByRole('button', { name: 'Inject simulation stream' }) },
  { route: 'investigations', ready: (page) => page.getByRole('heading', { level: 1, name: /investigations/i }) },
  { route: 'trust', ready: (page) => page.getByRole('heading', { level: 1, name: /credibility/i }) },
  { route: 'debate', ready: (page) => page.getByRole('heading', { level: 1, name: /debate/i }) },
  { route: 'fleet', ready: (page) => page.getByRole('heading', { level: 1, name: /fleet/i }) },
  { route: 'audit', ready: (page) => page.getByRole('heading', { level: 1, name: /audit/i }) },
  { route: 'access', ready: (page) => page.getByRole('heading', { level: 1, name: /access/i }) },
  { route: 'overview', ready: (page) => page.getByRole('heading', { level: 1, name: /forensic adjudication/i }) },
]

test('login through the UI, then every route renders cleanly', async ({ page, users }) => {
  const watch = watchHealth(page)
  const problems = watch.problems

  await test.step('sign in through the login screen', async () => {
    await page.goto(WEB_URL)
    await page.getByRole('button', { name: /launch console/i }).click()
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
    await page.getByLabel('Username', { exact: true }).fill(users.analyst.username)
    await page.getByLabel('Password', { exact: true }).fill(users.analyst.password)
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await expect(page).toHaveURL(/#\/dashboard$/)
    await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible()
    // The signed-in analyst's own name comes from /auth/me.
    await expect(page.getByText(users.analyst.username, { exact: true }).first()).toBeVisible()
    expect(problems, 'login').toEqual([])
  })

  for (const { route, ready } of ROUTES) {
    await test.step(`#/${route}`, async () => {
      await page.getByRole('navigation', { name: 'Primary' }).getByRole('link').first().waitFor()
      await page.evaluate((hash) => (window.location.hash = hash), `#/${route}`)
      await expect(ready(page)).toBeVisible()
      // Let the screen's own requests settle before judging it.
      await watch.settled()
      expect(problems, `#/${route}`).toEqual([])
    })
  }

  await test.step('the detail routes of the investigation that was run', async () => {
    for (const route of [`debate/${investigationId}`, `investigations/${investigationId}`]) {
      await page.evaluate((hash) => (window.location.hash = hash), `#/${route}`)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      await expect(page.getByText(investigationId.slice(0, 8)).first()).toBeVisible()
      await watch.settled()
      expect(problems, `#/${route}`).toEqual([])
    }
  })
})
