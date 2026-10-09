// Playwright webServer command for the API: create the database when missing, migrate it, then serve
// backend.api.main:app with the offline LLM stub (backend/scripts/e2e_server.py) on the E2E port.
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { API_PORT, PYTHON, REPO_ROOT, backendEnv, python, seedRows } from './stack.mjs'

seedRows('ensure-db')
// alembic.ini lives in backend/, so the migration runs from there (the same as the CI step).
python(['-m', 'alembic', 'upgrade', 'head'], {}, join(REPO_ROOT, 'backend'))

const server = spawn(PYTHON, ['-m', 'backend.scripts.e2e_server', '--port', String(API_PORT)], {
  cwd: REPO_ROOT,
  env: backendEnv(),
  stdio: 'inherit',
})
server.on('exit', (code) => process.exit(code ?? 0))
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.kill())
