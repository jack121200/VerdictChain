// The isolated E2E stack: its own database (verdictchain_test_pw), Redis db 7, API on 8100 and Vite on 5190.
// It never touches the dev API (8000), the dev Vite (5180), the dev database or Redis db 0.
// Plain Node (no TypeScript) so `node e2e/support/start-backend.mjs` works on any supported Node version.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const FRONTEND_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
export const REPO_ROOT = resolve(FRONTEND_DIR, '..')
export const SEED_ROWS = join(FRONTEND_DIR, 'e2e', 'support', 'seed_rows.py')

export const API_PORT = Number(process.env.E2E_API_PORT ?? 8100)
export const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 5190)
export const API_URL = `http://127.0.0.1:${API_PORT}`
export const WEB_URL = `http://127.0.0.1:${WEB_PORT}`

const E2E_DATABASE = 'verdictchain_test_pw'
const E2E_REDIS = 'redis://127.0.0.1:6379/7'
const PYTHON = process.env.E2E_PYTHON ?? 'python'

/** One KEY=value from the repo-root .env (or undefined). Values are never printed. */
function dotenv(key) {
  const file = join(REPO_ROOT, '.env')
  if (!existsSync(file)) return undefined
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/)
    if (match && match[1] === key) return match[2].replace(/^(['"])(.*)\1$/, '$2')
  }
  return undefined
}

/**
 * The dev database URL with the database name replaced by verdictchain_test_pw.
 * E2E_DATABASE_URL (CI) wins, but it must end in that same database name.
 */
export function testDatabaseUrl() {
  const base = process.env.E2E_DATABASE_URL ?? process.env.LOCAL_DATABASE_URL ?? dotenv('LOCAL_DATABASE_URL')
  if (!base) throw new Error('No LOCAL_DATABASE_URL in the environment or the repo-root .env')
  const url = base.replace(/\/[^/?]+(\?.*)?$/, (_, query = '') => `/${E2E_DATABASE}${query}`)
  if (!url.includes(`/${E2E_DATABASE}`)) throw new Error('Could not derive the E2E database URL')
  return url
}

/** The environment of every backend process of this stack. Provider keys are blanked: the stub serves all LLM calls. */
export function backendEnv() {
  return {
    ...process.env,
    PYTHONPATH: REPO_ROOT,
    PYTHONUTF8: '1',
    ENVIRONMENT: 'development',
    LOCAL_DATABASE_URL: testDatabaseUrl(),
    REDIS_URL: process.env.E2E_REDIS_URL ?? E2E_REDIS,
    // No real key in this stack: the offline stub serves every model call (it sets a placeholder key itself).
    OPENAI_API_KEY: '',
    OPENAI_MODEL: '',
    // The suite runs more debates than the production daily caps allow; the caps are tested in the backend suite.
    DEBATE_DAILY_LIMIT_USER: '500',
    DEBATE_DAILY_LIMIT_GLOBAL: '1000',
    // The live feed has its own RabbitMQ queue here (never the dev stack's) and replays only the scenario rows, so
    // the live spec gets a flagged window within seconds. Its daily cap is generous for the same reason as above.
    LIVE_FEED_QUEUE: 'verdictchain_pw_live',
    LIVE_FEED_ATTACK_SHARE: '1',
    LIVE_MIN_GAP_SECONDS: '3',
    LIVE_DAILY_CAP: '100',
    // The live feed waits for this many rows before it may start a debate (the Live page chooses it per run).
    LIVE_LLM_AFTER_ROWS: '50',
    // Replaced per run by the global setup.
    BOOTSTRAP_LEAD_USERNAME: '',
    BOOTSTRAP_LEAD_PASSWORD: '',
  }
}

/** Runs python synchronously (default cwd: the repo root); stdout/stderr go to the parent's. */
export function python(args, extraEnv = {}, cwd = REPO_ROOT) {
  execFileSync(PYTHON, args, {
    cwd,
    env: { ...backendEnv(), ...extraEnv },
    stdio: 'inherit',
  })
}

/** seed_rows.py with its arguments: ensure-db | seed | reset [--rows keep|seed|empty] [--drop-users]. */
export function seedRows(...args) {
  python([SEED_ROWS, ...args])
}

export { PYTHON }
