// A phone-width screen (390 x 844): no page of the console may scroll sideways. A wide table or matrix scrolls inside
// its own box (overflow-x), but the page itself must fit, so nothing is cut off and nothing needs a pinch to read.
import type { Page } from '@playwright/test'
import { STORAGE, injectAndWait, resetState } from './support/api'
import { WEB_URL } from './support/stack.mjs'
import { expect, test } from './support/fixtures'

test.use({ storageState: STORAGE.analyst, viewport: { width: 390, height: 844 } })

let investigationId = ''

test.beforeAll(async ({}, testInfo) => {
  testInfo.setTimeout(120_000)
  await resetState('seed')
})

/** The elements whose right edge is beyond the viewport and that no scrolling box of their own contains. */
async function overflowing(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const limit = window.innerWidth
    const scrolls = (element: Element | null): boolean => {
      for (let node = element; node !== null && node !== document.body; node = node.parentElement) {
        const style = getComputedStyle(node)
        if (['auto', 'scroll'].includes(style.overflowX)) return true
      }
      return false
    }
    const name = (node: Element) => `${node.tagName.toLowerCase()}.${String(node.className).split(/\s+/).slice(0, 3).join('.')}`
    const found: string[] = []
    for (const element of Array.from(document.body.querySelectorAll('*'))) {
      const box = element.getBoundingClientRect()
      if (box.width === 0 || box.right <= limit + 1 || scrolls(element.parentElement)) continue
      const parents: string[] = []
      for (let node = element.parentElement; node !== null && node !== document.body && parents.length < 3; node = node.parentElement) parents.push(name(node))
      found.push(`${name(element)} right=${Math.round(box.right)} "${(element.textContent ?? '').trim().slice(0, 40)}" in ${parents.join(' < ')}`)
      if (found.length >= 4) break
    }
    return found
  })
}

test('the case exists', async ({ users }) => {
  investigationId = await injectAndWait(users.analyst.token)
  expect(investigationId).toMatch(/^[0-9a-f-]{36}$/)
})

const ROUTES = ['overview', 'dashboard', 'live', 'investigations', 'debate', 'trust', 'fleet', 'audit', 'access']

for (const route of ROUTES) {
  test(`#/${route} fits a 390 px screen`, async ({ page }) => {
    await page.goto(`${WEB_URL}/#/${route}`)
    await expect(page.getByRole('main')).toBeVisible()
    await page.waitForTimeout(2500) // data, charts and tables have arrived
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth)
    expect(scrollWidth, `page width ${scrollWidth}px against a 390px screen; wide elements: ${(await overflowing(page)).join(' | ')}`).toBeLessThanOrEqual(390)
  })
}

test('#/debate/<id> and #/investigations/<id> fit a 390 px screen', async ({ page }) => {
  for (const route of [`debate/${investigationId}`, `investigations/${investigationId}`]) {
    await page.goto(`${WEB_URL}/#/${route}`)
    await expect(page.getByRole('main')).toBeVisible()
    await page.waitForTimeout(3000)
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth)
    expect(scrollWidth, `${route}: page width ${scrollWidth}px; wide elements: ${(await overflowing(page)).join(' | ')}`).toBeLessThanOrEqual(390)
  }
})

test('the landing and sign-in screens fit a 390 px screen', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await context.newPage()
  for (const route of ['landing', 'login']) {
    await page.goto(`${WEB_URL}/#/${route}`)
    await page.waitForTimeout(1500)
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth)
    expect(scrollWidth, `${route}: page width ${scrollWidth}px; wide elements: ${(await overflowing(page)).join(' | ')}`).toBeLessThanOrEqual(390)
  }
  await context.close()
})
