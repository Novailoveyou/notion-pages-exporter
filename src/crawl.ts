import type { Page } from "puppeteer";
import { waitForLiveNotionUi } from "./snapshot.ts";
import { normalizePageUrl, pageKey } from "./urls.ts";

export type CrawlState = {
  queue: string[];
  visited: Set<string>;
  /** pageKey → absolute page URL used for crawl */
  pages: Map<string, string>;
};

export function createCrawl(rootUrl: string): CrawlState {
  const normalized = normalizePageUrl(rootUrl);
  if (!normalized) {
    throw new Error(`Not a valid Notion public page URL: ${rootUrl}`);
  }
  const key = pageKey(normalized);
  if (!key) throw new Error(`Could not extract page id from: ${rootUrl}`);

  return {
    queue: [normalized],
    visited: new Set(),
    pages: new Map([[key, normalized]]),
  };
}

export function enqueueIfNew(
  state: CrawlState,
  rawUrl: string,
  baseUrl: string,
): boolean {
  const normalized = normalizePageUrl(rawUrl, baseUrl);
  if (!normalized) return false;
  const key = pageKey(normalized);
  if (!key) return false;
  if (state.visited.has(key) || state.pages.has(key)) return false;
  state.pages.set(key, normalized);
  state.queue.push(normalized);
  return true;
}

/**
 * Collect every same-site Notion page link from the rendered DOM.
 * Aggressive: anchors, role=link, and collection views.
 */
export async function collectSameSiteLinks(
  page: Page,
  currentUrl: string,
): Promise<string[]> {
  const origin = new URL(currentUrl).origin;
  const hrefs = await page.evaluate((siteOrigin) => {
    const out = new Set<string>();
    const pageIdInPath = /(?:-|\/)([0-9a-f]{32})(?:\?|#|$)/i;

    const add = (href: string | null | undefined) => {
      if (!href) return;
      const trimmed = href.trim();
      if (
        !trimmed ||
        trimmed.startsWith("javascript:") ||
        trimmed.startsWith("mailto:") ||
        trimmed.startsWith("tel:") ||
        trimmed.startsWith("data:")
      ) {
        return;
      }
      try {
        const u = new URL(trimmed, siteOrigin);
        if (u.origin !== siteOrigin) return;
        if (
          /\.(png|jpe?g|gif|webp|svg|css|js|woff2?|mp3|mp4|pdf|json)(\?|$)/i.test(
            u.pathname,
          )
        ) {
          return;
        }
        if (
          pageIdInPath.test(u.pathname) ||
          u.pathname === "/" ||
          u.pathname.length > 1
        ) {
          out.add(`${u.origin}${u.pathname}`);
        }
      } catch {
        /* ignore */
      }
    };

    for (const a of Array.from(document.querySelectorAll("a[href]"))) {
      add(a.getAttribute("href"));
    }

    for (const el of Array.from(
      document.querySelectorAll(
        "[data-href], [role='link'], .notion-link-token",
      ),
    )) {
      add(el.getAttribute("data-href") || el.getAttribute("href"));
    }

    for (const el of Array.from(
      document.querySelectorAll(
        ".notion-collection-item a[href], .notion-page-block a[href], .notion-table-view a[href], .notion-list-view a[href], .notion-gallery-view a[href], .notion-board-view a[href]",
      ),
    )) {
      add(el.getAttribute("href"));
    }

    return [...out];
  }, origin);

  const normalized: string[] = [];
  for (const href of hrefs) {
    const n = normalizePageUrl(href, currentUrl);
    if (n) normalized.push(n);
  }
  return [...new Set(normalized)];
}

export async function waitForNotionContent(
  page: Page,
  opts: { deep?: boolean } = {},
): Promise<void> {
  const deep = opts.deep !== false;
  await waitForLiveNotionUi(page);
  if (!deep) {
    // Enough for fingerprint / cache check — skip scroll + second settle
    await settleNetwork(page, 400, 4_000);
    return;
  }
  await settleNetwork(page, 350, 6_000);
  await scrollPage(page);
  await settleNetwork(page, 350, 6_000);
}

async function settleNetwork(
  page: Page,
  idleTime = 350,
  timeout = 6_000,
): Promise<void> {
  try {
    await page.waitForNetworkIdle({ idleTime, timeout });
  } catch {
    await new Promise((r) => setTimeout(r, Math.min(600, idleTime + 100)));
  }
}

async function scrollPage(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const height = () =>
      Math.max(
        document.body.scrollHeight,
        document.documentElement.scrollHeight,
      );
    let prev = 0;
    // Fewer, faster scrolls — enough to trigger lazy media
    for (let i = 0; i < 20; i++) {
      const h = height();
      if (h <= prev) break;
      prev = h;
      window.scrollTo(0, h);
      await delay(120);
    }
    window.scrollTo(0, 0);
    await delay(150);
  });
}
