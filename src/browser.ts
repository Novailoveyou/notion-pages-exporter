import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import puppeteer, { type Browser, type Page } from "puppeteer";
import { info, note, warn } from "./ui.ts";

export type LaunchBrowserOptions = {
  headless?: boolean;
  /** Persist cookies / CF clearance across runs */
  userDataDir?: string;
};

export function defaultUserDataDir(): string {
  return join(homedir(), ".notion-static-parser", "chrome-profile");
}

function isCi(): boolean {
  return Boolean(
    process.env.CI ||
      process.env.GITHUB_ACTIONS ||
      process.env.GITLAB_CI ||
      process.env.CIRCLECI,
  );
}

function resolveExecutablePath(): string | undefined {
  const fromEnv =
    process.env.PUPPETEER_EXECUTABLE_PATH?.trim() ||
    process.env.CHROME_PATH?.trim() ||
    process.env.CHROMIUM_PATH?.trim() ||
    process.env.GOOGLE_CHROME_BIN?.trim();
  return fromEnv || undefined;
}

/** Args that keep Chromium stable in Linux containers / GitHub Actions. */
function launchArgs(): string[] {
  const args = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--disable-software-rasterizer",
    "--disable-blink-features=AutomationControlled",
    "--disable-features=IsolateOrigins,site-per-process,TranslateUI",
    "--window-size=1440,900",
    "--font-render-hinting=none",
  ];
  if (isCi()) {
    // Extra hardening for ephemeral runners
    args.push(
      "--no-zygote",
      "--disable-background-networking",
      "--mute-audio",
      "--hide-scrollbars",
    );
  }
  return args;
}

export async function launchBrowser(
  opts: LaunchBrowserOptions = {},
): Promise<Browser> {
  const userDataDir = opts.userDataDir?.trim() || defaultUserDataDir();
  mkdirSync(userDataDir, { recursive: true });
  info(`Chrome profile ${userDataDir}`);
  if (isCi()) note("CI detected — using container-safe Chromium flags");

  const headless = opts.headless !== false;
  const executablePath = resolveExecutablePath();
  if (executablePath) {
    note(`Chrome binary ${executablePath}`);
  }

  const common = {
    headless: headless ? true : false,
    ignoreHTTPSErrors: true,
    userDataDir,
    args: launchArgs(),
    defaultViewport: { width: 1440, height: 900 },
    timeout: 120_000,
    ...(executablePath ? { executablePath } : {}),
  };

  // Prefer explicit binary (GHA setup-chrome), then system Chrome, then bundled
  if (executablePath) {
    try {
      return await puppeteer.launch(common);
    } catch (e) {
      warn(
        `Chrome at ${executablePath} failed (${e instanceof Error ? e.message : e}); trying fallbacks`,
      );
    }
  }

  if (!isCi()) {
    try {
      return await puppeteer.launch({ ...common, channel: "chrome" });
    } catch (e) {
      warn(
        `System Chrome unavailable (${e instanceof Error ? e.message : e}); using bundled Chromium`,
      );
    }
  }

  return await puppeteer.launch(common);
}

export async function preparePage(browser: Browser): Promise<Page> {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  // Keep default UA from real Chrome — Notion/CF stall on fake outdated UAs.
  await page.evaluateOnNewDocument(() => {
    try {
      Object.defineProperty(navigator, "webdriver", {
        get: () => undefined,
      });
    } catch {
      /* ignore */
    }
  });
  return page;
}
