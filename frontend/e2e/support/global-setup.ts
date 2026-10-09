// Runs once before the specs, after the two web servers are up: a clean E2E database with the synthetic
// rows, two throwaway users (a forensic analyst and a secops lead) and their browser sessions.
import { randomBytes } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { AUTH_DIR, STORAGE, call, ok, setFabricate, type E2EUser } from './api'
import { API_URL, WEB_URL, python, seedRows } from './stack.mjs'

const TOKEN_KEY = 'verdictchain_token'

function throwaway(prefix: string): { username: string; password: string } {
  return { username: `${prefix}_${randomBytes(3).toString('hex')}`, password: randomBytes(18).toString('base64url') }
}

async function createUser(prefix: string): Promise<{ username: string; password: string }> {
  const credentials = throwaway(prefix)
  const result = await call(null, 'POST', '/auth/register', credentials)
  if (result.status !== 200) throw new Error(`register ${credentials.username} -> ${result.status}`)
  return credentials
}

async function signIn(credentials: { username: string; password: string }): Promise<E2EUser> {
  const token = await ok<{ access_token: string }>(null, 'POST', '/auth/login', credentials)
  return { ...credentials, token: token.access_token }
}

/** A Playwright storageState file: the token in the console's localStorage, so no UI login is needed. */
function writeStorage(file: string, token: string): void {
  const state = { cookies: [], origins: [{ origin: WEB_URL, localStorage: [{ name: TOKEN_KEY, value: token }] }] }
  writeFileSync(file, JSON.stringify(state))
}

export default async function globalSetup(): Promise<void> {
  const health = await fetch(`${API_URL}/health`)
  if (!health.ok) throw new Error(`E2E API at ${API_URL} is not healthy`)

  // Empty everything of this stack (never the dev database; seed_rows.py refuses anything else).
  seedRows('reset', '--rows', 'seed', '--drop-users')
  await setFabricate([]) // the stub's in-process switch is not in the database
  mkdirSync(AUTH_DIR, { recursive: true })

  const analystLogin = await createUser('pw_analyst')
  const leadLogin = await createUser('pw_lead')
  // Promote exactly one of them with the real bootstrap script, the way a deployment gets its first lead.
  python(['-m', 'backend.scripts.bootstrap_lead'], {
    BOOTSTRAP_LEAD_USERNAME: leadLogin.username,
    BOOTSTRAP_LEAD_PASSWORD: leadLogin.password,
  })

  const analyst = await signIn(analystLogin)
  const lead = await signIn(leadLogin)
  const roles = {
    analyst: (await ok(analyst.token, 'GET', '/auth/me')).role,
    lead: (await ok(lead.token, 'GET', '/auth/me')).role,
  }
  if (roles.analyst !== 'forensic_analyst' || roles.lead !== 'secops_lead') {
    throw new Error(`unexpected roles after setup: ${JSON.stringify(roles)}`)
  }

  writeFileSync(join(AUTH_DIR, 'users.json'), JSON.stringify({ analyst, lead }))
  writeStorage(STORAGE.analyst, analyst.token)
  writeStorage(STORAGE.lead, lead.token)
}
