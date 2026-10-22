import { defineConfig } from "@playwright/test";
import base from "./playwright.config";
const url = new URL(process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3002");
export default defineConfig({
  ...base,
  globalSetup: undefined,
  webServer: { ...base.webServer, command: `node node_modules/next/dist/bin/next start --port ${url.port || "3002"}`, url: `${url.origin}/login`, reuseExistingServer: false },
});
