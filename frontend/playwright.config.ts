import { defineConfig, devices } from '@playwright/test'
import { API_URL, FRONTEND_DIR, WEB_PORT, WEB_URL } from './e2e/support/stack.mjs'

// E2E runs against its OWN stack, never the dev one (dev API 8000, dev Vite 5180, database verdictchain, Redis db 0):
//   API   http://127.0.0.1:8100  backend.testing.e2e_server (real API + offline LLM stub), database
//                                verdictchain_test_pw, Redis db 7, provider keys blanked
//   Web   http://127.0.0.1:5190  Vite dev server with VITE_API_BASE pointing at that API
// Both start from the webServer entries below (and are reused when already running). Run: pnpm e2e
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  outputDir: './e2e/.results',
  globalSetup: './e2e/support/global-setup.ts',
  // One worker, no parallelism: the specs share one API, one debate slot and the stub's fabricate switch.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    baseURL: WEB_URL,
    trace: 'retain-on-failure',
    viewport: { width: 1440, height: 900 },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
  webServer: [
    {
      // Creates the database when missing, runs alembic, then serves the API with the LLM stub installed.
      command: 'node e2e/support/start-backend.mjs',
      cwd: FRONTEND_DIR,
      url: `${API_URL}/health`,
      timeout: 180_000,
      reuseExistingServer: true,
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      command: `pnpm dev --port ${WEB_PORT} --strictPort --host 127.0.0.1`,
      cwd: FRONTEND_DIR,
      url: WEB_URL,
      timeout: 120_000,
      reuseExistingServer: true,
      env: { VITE_API_BASE: API_URL },
      stdout: 'ignore',
      stderr: 'pipe',
    },
  ],
})
