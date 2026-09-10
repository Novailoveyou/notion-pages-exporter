import type { Page } from "puppeteer";
import { note, warn } from "./ui.ts";
import { extractPageId } from "./urls.ts";

/** Cloudflare / bot interstitial ("Just a moment..."). */
export async function isChallengePage(page: Page): Promise<boolean> {
  try {
    const title = (await page.title()).trim();
    if (/just a moment/i.test(title)) return true;
    if (/attention required|access denied|cf-error/i.test(title)) return true;

    return await page.evaluate(() => {
      const text = (document.body?.innerText || "").slice(0, 500);
      if (/just a moment/i.test(text)) return true;
      if (/checking your browser|enable javascript and cookies/i.test(text)) {
        return true;
      }
      return Boolean(
        document.querySelector(
          "#challenge-running, #challenge-form, #cf-challenge-running, .cf-browser-verification, #challenge-body-text",
        ),
      );
    });
  } catch {
    return false;
  }
}

/**
 * Wait until Cloudflare clears (cf_clearance / title change) or timeout.
 * Returns true if the page looks clear of the challenge.
 */
export async function waitOutChallenge(
  page: Page,
  timeoutMs = 90_000,
): Promise<boolean> {
  if (!(await isChallengePage(page))) return true;

  warn("Cloudflare challenge detected — waiting for clearance…");
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 1500));

    try {
      await page.waitForNavigation({
        waitUntil: "domcontentloaded",
        timeout: 2000,
      });
    } catch {
      /* no nav */
    }

    if (!(await isChallengePage(page))) {
      note("Challenge cleared");
      return true;
    }
  }

  return !(await isChallengePage(page));
}

export async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

/** Human-like pause between navigations. Uses small jitter; skip when baseMs ≤ 0. */
export async function crawlDelay(baseMs: number): Promise<void> {
  if (baseMs <= 0) return;
  const jitter = Math.floor(Math.random() * Math.min(250, Math.max(50, baseMs * 0.25)));
  await sleep(baseMs + jitter);
}

/**
 * Global spacing between navigations across workers (avoids N×delay with concurrency).
 */
export function createNavGate(baseMs: number): () => Promise<void> {
  let nextAt = 0;
  return async () => {
    if (baseMs <= 0) return;
    const now = Date.now();
    const wait = nextAt - now;
    const jitter = Math.floor(Math.random() * Math.min(200, baseMs * 0.2));
    nextAt = Math.max(now, nextAt) + baseMs + jitter;
    if (wait > 0) await sleep(wait);
  };
}

/**
 * Navigate to a Notion page. Prefer in-app link click (SPA) to avoid
 * re-triggering Cloudflare; fall back to full goto.
 */
export async function navigateToPage(
  page: Page,
  url: string,
  opts: { allowSpaClick?: boolean } = {},
): Promise<void> {
  const allowSpa = opts.allowSpaClick !== false;
  const targetId = extractPageId(url);

  if (allowSpa && targetId) {
    const clicked = await page.evaluate((id) => {
      const anchors = Array.from(document.querySelectorAll("a[href]"));
      for (const a of anchors) {
        const href = a.getAttribute("href") || "";
        if (href.replace(/-/g, "").toLowerCase().includes(id)) {
          (a as HTMLAnchorElement).click();
          return true;
        }
      }
      return false;
    }, targetId);

    if (clicked) {
      try {
        await page.waitForNavigation({
          waitUntil: "domcontentloaded",
          timeout: 30_000,
        });
      } catch {
        await page
          .waitForFunction(
            (id) =>
              location.href.replace(/-/g, "").toLowerCase().includes(id),
            { timeout: 30_000 },
            targetId,
          )
          .catch(() => undefined);
      }
      return;
    }
  }

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90_000 });
}
