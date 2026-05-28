import { defineConfig, devices } from "@playwright/test";

const smokeOnly = process.env.PLAYWRIGHT_SMOKE === "1";
const port = process.env.PORT || "3000";
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: smokeOnly ? "**/smoke.spec.ts" : "**/*.spec.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  webServer: {
    // Force -p so E2E matches baseURL even when .env.local sets a different PORT.
    command: `npm run start -- -p ${port} -H 0.0.0.0`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
