// Every run gets its own temp folder, deleted on exit, so a stopped or crashed
// run leaves no browser profile behind. See test/e2e/tidy-browser.cjs.
import "./test/e2e/tidy-browser.cjs";
import { defineConfig } from "@playwright/test";

// End-to-end tests run in Playwright's own browsers (never a system browser),
// against the dev server: Vite, the Worker and the Durable Object together.
//
// `npm run test:e2e` runs everything in Chromium. `npm run test:e2e:browsers` runs
// the 2D game in WebKit and Firefox as well: every iPhone is WebKit, and both get
// the frosted-glass fallback instead of refraction.

// TRIVIA_URL points the tests at another copy: `vite preview`, or the deployed site.
const target = process.env.TRIVIA_URL;

export default defineConfig({
  testDir: "test/e2e",
  testMatch: "**/*.spec.ts",
  timeout: 90_000,
  // The dev server compiles pages on demand, and WebGL here is software: allow for it.
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: target ?? "http://localhost:5173" },
  projects: [
    {
      name: "chromium",
      use: {
        browserName: "chromium",
        // Software WebGL, so the 3D arena renders on machines without a GPU.
        launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] },
      },
    },
    { name: "webkit", use: { browserName: "webkit" }, grep: /hosted on .host.2d/ },
    { name: "firefox", use: { browserName: "firefox" }, grep: /hosted on .host.2d/ },
  ],
  webServer: target
    ? undefined
    : {
        command: "npm run dev",
        url: "http://localhost:5173",
        reuseExistingServer: true,
        timeout: 60_000,
      },
});
