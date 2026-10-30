import { mkdirSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';
mkdirSync('artifacts', {recursive: true});
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  expect: { timeout: 10000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium-mobile',
      use: {
        ...devices['iPhone 13'],
        defaultBrowserType: 'chromium',
        browserName: 'chromium',
        launchOptions: {
          executablePath:
            process.env.FITNESS_CHROME_PATH ??
            (existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
              ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
              : undefined),
        },
      },
    },
    { name: 'webkit-mobile', use: { ...devices['iPhone 13'], browserName: 'webkit' } },
  ],
  webServer: {
    command: 'pnpm preview',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
});
