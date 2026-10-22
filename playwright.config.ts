import { defineConfig } from '@playwright/test';

const backendPort = 3100;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${backendPort}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'node e2e/start-backend.mjs',
      url: `http://127.0.0.1:${backendPort}/api/system`,
      timeout: 120_000,
      reuseExistingServer: false,
      env: { ...process.env, E2E_BACKEND_PORT: String(backendPort) },
    },
  ],
});
