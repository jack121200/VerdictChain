// The two printable documents of a finished case: the designed case report (#/report/<id>) and the chain-of-custody
// record (#/custody/<id>). They open from the dossier, show the case's own numbers, recompute the digests in the
// browser, hide the screen toolbar when printed, and print to a real PDF (Chromium's page.pdf is the same engine
// as the browser's Save as PDF). The PDFs are kept under e2e/.results for a look.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { STORAGE, getInvestigation, injectAndWait, ok, resetState } from './support/api'
import { expect, gotoRoute, test, watchHealth } from './support/fixtures'

test.use({ storageState: STORAGE.lead })

const RESULTS = fileURLToPath(new URL('./.results', import.meta.url))

test.beforeAll(async () => {
  await resetState('seed')
})

const ACTION_WORDS: Record<string, string> = {
  lock_account: 'Lock account',
  block_ip_range: 'Block IP range',
  trigger_rate_limiting: 'Apply rate limiting',
  trigger_audit: 'Open an audit',
}

function pageCount(pdf: Buffer): number {
  return (pdf.toString('latin1').match(/\/Type\s*\/Page\b(?!s)/g) ?? []).length
}

test('a finished case opens as a designed report and prints to a PDF', async ({ page, users }) => {
  const { lead } = users
  const watch = watchHealth(page)
  const id = await injectAndWait(lead.token, 'DDoS')
  const detail = await getInvestigation(lead.token, id)
  expect(detail.actions.length, 'a DDoS verdict is contained, so there is a playbook to print').toBeGreaterThan(0)

  // ---- the dossier offers both documents once the case is complete -------------------------------------------
  await gotoRoute(page, `investigations/${id}`)
  await expect(page.getByRole('button', { name: 'Report PDF', exact: true })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Custody PDF', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Report PDF', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`#/report/${id}$`))

  // ---- the document: no console chrome, the case's own verdict and every section ----------------------------
  await expect(page.getByRole('navigation', { name: 'Primary' })).toHaveCount(0)
  await expect(page.getByLabel('Report cover')).toContainText('DDoS')
  await expect(page.getByLabel('Report cover')).toContainText(id)
  for (const title of ['Summary', 'How the automation handled it', 'The investigators', 'The debate, round by round', 'Aggregation', 'Evidence the Watchdog re-checked', 'Evidence storyline', 'Self-Healing response', 'Integrity']) {
    await expect(page.getByRole('region', { name: title }), title).toBeVisible()
  }
  const healing = page.getByRole('region', { name: 'Self-Healing response' })
  await expect(healing).toContainText('Contained in the sandbox')
  for (const action of detail.actions as Array<{ action_type: string }>) {
    await expect(healing.getByText(ACTION_WORDS[action.action_type] ?? action.action_type).first()).toBeVisible()
  }
  const integrity = page.getByRole('region', { name: 'Integrity' })
  await expect(integrity).toContainText('Bundle hash recomputed here: it matches')
  await expect(integrity).toContainText('Case digest recomputed here: it matches')
  await expect(integrity).toContainText('Global audit chain valid')
  await expect(integrity).toContainText('not a digital signature')
  const download = page.getByRole('button', { name: 'Download PDF', exact: true })
  await expect(download).toBeEnabled()

  // ---- printed: the toolbar is gone and Chromium makes a multi-page A4 PDF ------------------------------------
  await page.emulateMedia({ media: 'print' })
  await expect(download).toBeHidden()
  const pdf = await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true })
  expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-')
  expect(pdf.length, 'a designed document, not an empty page').toBeGreaterThan(30_000)
  expect(pageCount(pdf)).toBeGreaterThanOrEqual(2)
  mkdirSync(RESULTS, { recursive: true })
  writeFileSync(join(RESULTS, `report-${id.slice(0, 8)}.pdf`), pdf)

  expect(watch.problems).toEqual([])
})

test('the chain of custody prints every audit entry of the case with its hash, recomputed in the browser', async ({ page, users }) => {
  const { lead } = users
  const watch = watchHealth(page)
  const id = await injectAndWait(lead.token, 'DDoS')
  const chain = await ok<{ entries: Array<{ entry_hash: string }>; case_digest: string }>(lead.token, 'GET', `/investigations/${id}/audit-chain`)
  expect(chain.entries.length).toBeGreaterThan(5)

  await gotoRoute(page, `investigations/${id}`)
  await page.getByRole('button', { name: 'Custody PDF', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`#/custody/${id}$`))

  const events = page.getByRole('region', { name: 'Custody events' })
  await expect(events.getByRole('row')).toHaveCount(2 * chain.entries.length + 1) // the header row, then two rows per entry: its facts and its full hash
  await expect(events.getByText('yes, matches', { exact: true })).toHaveCount(chain.entries.length) // every hash recomputed here
  for (const entry of chain.entries.slice(0, 3)) await expect(events).toContainText(entry.entry_hash) // the full hash, not a short one

  const summary = page.getByRole('region', { name: 'Custody summary' })
  await expect(summary).toContainText(chain.case_digest)
  await expect(summary).toContainText('Case digest recomputed here: it matches')
  await expect(summary).toContainText('Bundle hash recomputed here: it matches')
  await expect(page.getByRole('region', { name: 'Hand-over record' })).toContainText('Signature')
  await expect(page.getByRole('button', { name: 'Download PDF', exact: true })).toBeEnabled()

  await page.emulateMedia({ media: 'print' })
  const pdf = await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true })
  expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-')
  expect(pdf.length).toBeGreaterThan(20_000)
  mkdirSync(RESULTS, { recursive: true })
  writeFileSync(join(RESULTS, `custody-${id.slice(0, 8)}.pdf`), pdf)

  expect(watch.problems).toEqual([])
})
