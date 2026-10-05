import { defineConfig, devices } from '@playwright/test'

// E2E specs live in frontend/e2e (owned by the QA wave). The app and the backend are started
// by the caller, so no webServer block here: the E2E run needs the LLM stub backend, which
// this config must not start on its own.
export default defineConfig({
  testDir: './e2e',
  reporter: 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
  ],
})
