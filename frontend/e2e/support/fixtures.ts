// Shared Playwright fixtures: hermetic fonts, an authenticated browser context per role, and a watcher
// that records everything that must stay at zero on a healthy page.
import { test as base, expect, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { STORAGE, loadUsers, type E2EUsers } from './api'
import { WEB_URL } from './stack.mjs'

export { expect }

/** Google Fonts is the only third-party request the console makes. Answered locally: no network needed. */
async function stubFonts(context: BrowserContext): Promise<void> {
  await context.route(/fonts\.(googleapis|gstatic)\.com/, (route) =>
    route.fulfill({ status: 200, contentType: 'text/css', body: '' }),
  )
}

export const test = base.extend<{ users: E2EUsers }>({
  context: async ({ context }, use) => {
    await stubFonts(context)
    await use(context)
  },
  // eslint-disable-next-line no-empty-pattern
  users: async ({}, use) => {
    await use(loadUsers())
  },
})

/** A new browser context signed in as the given role (the token comes from the global setup). */
export async function sessionAs(browser: Browser, role: 'analyst' | 'lead'): Promise<BrowserContext> {
  const context = await browser.newContext({ storageState: STORAGE[role], viewport: { width: 1440, height: 900 } })
  await stubFonts(context)
  return context
}

/** Opens a hash route of the console and waits for the shell to be up. */
export async function gotoRoute(page: Page, route: string): Promise<void> {
  await page.goto(`${WEB_URL}/#/${route}`)
  await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible()
}

export interface PageWatch {
  /** Stays empty on a healthy page: console errors, page errors, failed requests, HTTP >= 400. */
  problems: string[]
  /** Resolves once the page has had no request in flight for a short, stable window. */
  settled: () => Promise<void>
}

/** Records page health from now on (see PageWatch). */
export function watchHealth(page: Page): PageWatch {
  const problems: string[] = []
  let pending = 0
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console.error: ${message.text()}`)
  })
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`))
  page.on('request', () => {
    pending += 1
  })
  page.on('requestfinished', () => {
    pending -= 1
  })
  page.on('requestfailed', (request) => {
    pending -= 1
    // A navigation that is replaced by the next one aborts its own requests; that is not a failure.
    if (request.failure()?.errorText !== 'net::ERR_ABORTED') {
      problems.push(`requestfailed: ${request.method()} ${request.url()} ${request.failure()?.errorText}`)
    }
  })
  page.on('response', (response) => {
    if (response.status() >= 400) {
      problems.push(`HTTP ${response.status()}: ${response.request().method()} ${response.url()}`)
    }
  })
  const settled = async (): Promise<void> => {
    const deadline = Date.now() + 15_000
    let quiet = 0
    while (quiet < 4 && Date.now() < deadline) {
      await page.waitForTimeout(100)
      quiet = pending <= 0 ? quiet + 1 : 0
    }
  }
  return { problems, settled }
}

/** The visible text of the whole page, as a reader sees it. */
export async function visibleText(page: Page): Promise<string> {
  return page.locator('body').innerText()
}
