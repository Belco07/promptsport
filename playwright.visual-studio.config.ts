import { defineConfig } from "@playwright/test";
import base from "./playwright.config";
const port = new URL(process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3002").port || "3002";
export default defineConfig({
  ...base,
  webServer: { ...base.webServer, command: `node node_modules/next/dist/bin/next dev --port ${port}`, reuseExistingServer: false },
});
