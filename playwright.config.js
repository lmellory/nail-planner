import { defineConfig, devices } from '@playwright/test';

const chromiumLaunch = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
  ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } } : {};

export default defineConfig({
  testDir: './test/browser',
  testMatch: '**/*.pw.js',
  fullyParallel: true,
  workers: process.env.CI ? 2 : 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    colorScheme: 'dark',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    serviceWorkers: 'block',
  },
  webServer: {
    command: 'node scripts/browser-server.js',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
  },
  projects: [
    { name: 'android', use: { ...devices['Pixel 7'], defaultBrowserType: 'chromium', ...chromiumLaunch } },
    { name: 'iphone', use: { ...devices['iPhone 13'], defaultBrowserType: 'webkit' } },
    { name: 'small-iphone', use: { browserName: 'webkit', viewport: { width: 320, height: 568 }, isMobile: true, hasTouch: true } },
    { name: 'landscape', use: { browserName: 'webkit', viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true } },
    { name: 'desktop-chrome', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 }, ...chromiumLaunch } },
    { name: 'desktop-webkit', use: { ...devices['Desktop Safari'], viewport: { width: 1280, height: 800 }, withTelegram: false } },
  ],
});
