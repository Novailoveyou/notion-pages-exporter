import type { Page } from "puppeteer";

export type CollectionViewCapture = {
  blockId: string;
  defaultLabel?: string;
  defaultIndex?: number;
  tabs: { label: string; html: string }[];
};

/**
 * Click each collection view tab and capture the rendered body HTML so we can
 * switch views offline without Notion's React runtime.
 */
export async function captureCollectionViews(
  page: Page,
): Promise<CollectionViewCapture[]> {
  return page.evaluate(async () => {
    const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

    const promoteMedia = (root: ParentNode) => {
      for (const img of Array.from(root.querySelectorAll("img"))) {
        const el = img as HTMLImageElement;
        const ds =
          el.getAttribute("data-src") ||
          el.getAttribute("data-lazy-src") ||
          el.getAttribute("data-original");
        const src = el.getAttribute("src") || "";
        if (
          ds &&
          (!src ||
            src.startsWith("data:image/svg") ||
            src.startsWith("data:image/gif"))
        ) {
          el.setAttribute("src", ds);
        }
        const srcset = el.getAttribute("srcset");
        if (srcset) {
          const candidates = srcset
            .split(",")
            .map((p) => p.trim().split(/\s+/)[0]!);
          const last = candidates[candidates.length - 1];
          if (last) el.setAttribute("src", last);
        }
        const cur = el.getAttribute("src");
        if (cur && !cur.startsWith("data:") && !cur.startsWith("blob:")) {
          try {
            el.setAttribute("src", new URL(cur, location.href).href);
          } catch {
            /* ignore */
          }
        }
      }
      for (const el of Array.from(
        root.querySelectorAll("a[href], audio[src], source[src], video[src]"),
      )) {
        for (const attr of ["href", "src"] as const) {
          const v = el.getAttribute(attr);
          if (!v || v.startsWith("#") || v.startsWith("data:") || v.startsWith("blob:"))
            continue;
          try {
            el.setAttribute(attr, new URL(v, location.href).href);
          } catch {
            /* ignore */
          }
        }
      }
    };

    const waitImages = async (root: ParentNode) => {
      const imgs = Array.from(root.querySelectorAll("img")).filter((img) => {
        const s = img.getAttribute("src") || "";
        return s.startsWith("http");
      }) as HTMLImageElement[];
      await Promise.all(
        imgs.map(
          (img) =>
            new Promise<void>((resolve) => {
              if (img.complete && img.naturalWidth > 0) return resolve();
              const done = () => resolve();
              img.addEventListener("load", done, { once: true });
              img.addEventListener("error", done, { once: true });
              setTimeout(done, 2500);
            }),
        ),
      );
    };

    const out: {
      blockId: string;
      defaultLabel?: string;
      defaultIndex?: number;
      tabs: { label: string; html: string }[];
    }[] = [];

    const blocks = Array.from(
      document.querySelectorAll(
        ".notion-collection_view-block[data-block-id], .notion-collection_view_page-block[data-block-id]",
      ),
    ) as HTMLElement[];

    // Prefer the instance that actually hosts the tablist — Notion duplicates
    // the same data-block-id on nested shells that have no tabs.
    const byId = new Map<string, HTMLElement[]>();
    for (const block of blocks) {
      const blockId = block.getAttribute("data-block-id") || "";
      if (!blockId) continue;
      const list = byId.get(blockId) || [];
      list.push(block);
      byId.set(blockId, list);
    }

    for (const [blockId, instances] of byId) {
      let root: HTMLElement | null = null;
      for (const block of instances) {
        const candidate =
          (block.closest(
            ".notion-selectable.notion-collection_view-block, .notion-selectable.notion-collection_view_page-block",
          ) as HTMLElement) || block;
        if (candidate.querySelector('[role="tablist"]')) {
          root = candidate;
          break;
        }
      }
      if (!root) continue;
      const tablist = root.querySelector('[role="tablist"]');
      if (!tablist) continue;

      // Prefer outer tab buttons — inner [role=tab] often opens a settings dialog
      const rawTabs = Array.from(
        tablist.querySelectorAll(
          ".notion-collection-view-tab-button, [role='tab'], .notion-collection-view-tab",
        ),
      ) as HTMLElement[];
      const tabs: HTMLElement[] = [];
      for (const t of rawTabs) {
        if (t.classList.contains("notion-collection-view-tab-button")) {
          tabs.push(t);
        } else if (!t.closest(".notion-collection-view-tab-button")) {
          tabs.push(t);
        }
      }
      if (tabs.length < 1) continue;

      const defaultIndex = Math.max(
        0,
        tabs.findIndex((t) => /gallery/i.test(t.textContent || "")),
      );
      const defaultLabel =
        (tabs[defaultIndex]?.textContent || "").replace(/\s+/g, " ").trim() ||
        "Gallery view";

      const captured: { label: string; html: string }[] = [];
      for (const tab of tabs) {
        const label =
          (tab.getAttribute("aria-label") || "")
            .replace(/\s+/g, " ")
            .trim() ||
          (tab.textContent || "").replace(/\s+/g, " ").trim() ||
          "View";
        // Prefer real pointer activation — Notion sometimes ignores .click()
        tab.dispatchEvent(
          new PointerEvent("pointerdown", { bubbles: true, cancelable: true }),
        );
        tab.dispatchEvent(
          new PointerEvent("pointerup", { bubbles: true, cancelable: true }),
        );
        tab.click();
        // Dismiss view-settings popover if the click opened one
        const esc = new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
        });
        document.dispatchEvent(esc);
        const wait = /calendar|table|board|timeline/i.test(label) ? 2200 : 1100;
        await delay(wait);

        const expectSel = /calendar/i.test(label)
          ? ".notion-calendar-view"
          : /table/i.test(label)
            ? ".notion-table-view"
            : /board/i.test(label)
              ? ".notion-board-view"
              : /list/i.test(label)
                ? ".notion-list-view"
                : /gallery/i.test(label)
                  ? ".notion-gallery-view"
                  : null;
        if (expectSel) {
          for (let i = 0; i < 8; i++) {
            if (root.querySelector(expectSel)) break;
            tab.click();
            document.dispatchEvent(esc);
            await delay(400);
          }
        }

        const body = root.querySelector(".notion-collection-view-body");
        if (body) {
          promoteMedia(body);
          await waitImages(body);
          await delay(200);
          promoteMedia(body);
          captured.push({ label, html: body.innerHTML });
        }
      }

      // Restore default Gallery view so freeze/scrape sees the preferred tab
      if (tabs[defaultIndex]) {
        tabs[defaultIndex]!.click();
        await delay(500);
        const body = root.querySelector(".notion-collection-view-body");
        if (body) {
          promoteMedia(body);
          await waitImages(body);
        }
      }

      if (captured.length) {
        out.push({
          blockId,
          defaultLabel,
          defaultIndex,
          tabs: captured,
        });
      }
    }
    return out;
  });
}

/**
 * Notion lazy-loads toggle children only after a real UI expand.
 * Synthetic evaluate-clicks often leave aria-expanded=false with empty bodies
 * (e.g. STUDENT A / STUDENT B). Use CDP clicks and wait for content.
 */
export async function expandAllToggles(page: Page): Promise<number> {
  let opened = 0;
  for (let pass = 0; pass < 12; pass++) {
    const before = await page.evaluate(
      () => document.querySelectorAll(".notion-toggle-block").length,
    );

    const closed = await page.$$(
      '.notion-toggle-block [role="button"][aria-expanded="false"]',
    );
    if (!closed.length) break;

    let passOpened = 0;
    for (const btn of closed) {
      try {
        await btn.evaluate((el) => {
          try {
            (el as HTMLElement).scrollIntoView({
              block: "center",
              inline: "nearest",
            });
          } catch {
            /* ignore */
          }
        });
        await btn.click({ delay: 20 });
        passOpened += 1;
        opened += 1;
        // Wait until this control reports open, or give up quickly
        await page
          .waitForFunction(
            (el) => el.getAttribute("aria-expanded") === "true",
            { timeout: 2500 },
            btn,
          )
          .catch(() => null);
        await new Promise((r) => setTimeout(r, 350));
      } catch {
        /* overlay / detached — continue */
      }
    }

    try {
      await page.waitForNetworkIdle({ idleTime: 400, timeout: 4_000 });
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }

    const after = await page.evaluate(
      () => document.querySelectorAll(".notion-toggle-block").length,
    );
    // No new nested toggles and nothing opened this pass → done
    if (passOpened === 0 && after <= before) break;
  }

  // Final settle so nested media requests can start
  try {
    await page.waitForNetworkIdle({ idleTime: 500, timeout: 5_000 });
  } catch {
    await new Promise((r) => setTimeout(r, 400));
  }
  return opened;
}

/**
 * Force Notion to mount lazy image/audio into the DOM, and extract source URLs
 * from React fiber props when the custom player stays empty.
 * Returns discovered remote media URLs (for download).
 */
export async function hydrateNotionMedia(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const found = new Set<string>();

    const abs = (u: string | null | undefined) => {
      if (!u || u.startsWith("data:") || u.startsWith("blob:")) return null;
      try {
        return new URL(u, location.href).href;
      } catch {
        return null;
      }
    };

    const add = (u: string | null | undefined) => {
      const a = abs(u);
      if (a && /^https?:/i.test(a)) found.add(a);
    };

    const walkFiber = (node: unknown, depth = 0): void => {
      if (!node || depth > 12) return;
      const n = node as Record<string, unknown>;
      const props = (n.memoizedProps || n.pendingProps || {}) as Record<
        string,
        unknown
      >;
      for (const key of [
        "src",
        "url",
        "source",
        "file",
        "signedUrl",
        "displaySource",
        "originalSource",
      ]) {
        const v = props[key];
        if (typeof v === "string") add(v);
        if (v && typeof v === "object") {
          const o = v as Record<string, unknown>;
          if (typeof o.url === "string") add(o.url);
          if (typeof o.src === "string") add(o.src);
          if (typeof o.signedUrl === "string") add(o.signedUrl);
        }
      }
      // Notion file blocks often nest under props.blockValue.format
      const bv = props.blockValue as Record<string, unknown> | undefined;
      const format = (bv?.format || props.format) as
        | Record<string, unknown>
        | undefined;
      if (format) {
        for (const key of [
          "display_source",
          "source",
          "file_ids",
          "page_cover",
        ]) {
          const v = format[key];
          if (typeof v === "string") add(v);
        }
      }
      walkFiber(n.child, depth + 1);
      walkFiber(n.sibling, depth + 1);
    };

    const fiberOf = (el: Element) => {
      const key = Object.keys(el).find(
        (k) =>
          k.startsWith("__reactFiber$") ||
          k.startsWith("__reactInternalInstance$"),
      );
      return key ? (el as unknown as Record<string, unknown>)[key] : null;
    };

    // Toggles should already be expanded via expandAllToggles(); keep a light
    // in-page pass for any that CDP missed.
    for (const block of Array.from(
      document.querySelectorAll(".notion-toggle-block"),
    )) {
      const btn = block.querySelector(
        '[role="button"][aria-expanded="false"]',
      ) as HTMLElement | null;
      if (btn) btn.click();
    }
    await delay(400);

    const mediaBlocks = Array.from(
      document.querySelectorAll(
        ".notion-image-block, .notion-audio-block, .notion-video-block, .notion-file-block",
      ),
    ) as HTMLElement[];

    for (const block of mediaBlocks) {
      try {
        block.scrollIntoView({ block: "center", inline: "nearest" });
      } catch {
        /* ignore */
      }
      await delay(200);

      // Click to force Notion player / image mount
      const hit =
        block.querySelector("[role='button']") ||
        block.querySelector("[role='figure']") ||
        block;
      try {
        (hit as HTMLElement).click();
      } catch {
        /* ignore */
      }
      await delay(350);

      // Pull URLs from React fiber
      walkFiber(fiberOf(block));

      // Collect whatever Notion mounted
      for (const el of Array.from(
        block.querySelectorAll("img[src], audio[src], source[src], video[src], a[href]"),
      )) {
        add(el.getAttribute("src"));
        add(el.getAttribute("href"));
      }
    }

    // Performance resource entries catch lazy loads we missed in DOM attrs
    try {
      for (const e of performance.getEntriesByType("resource")) {
        const u = (e as PerformanceResourceTiming).name;
        if (
          /\/(image|file)\//i.test(u) ||
          /file\.notion\.so/i.test(u) ||
          /\.(mp3|m4a|png|jpe?g|webp|gif)(\?|$)/i.test(u)
        ) {
          add(u);
        }
      }
    } catch {
      /* ignore */
    }

    // Inject <img>/<audio> into still-empty figures using discovered URLs keyed by block id
    const byBlock = new Map<string, string[]>();
    for (const u of found) {
      try {
        const id = new URL(u).searchParams.get("id");
        if (!id) continue;
        const list = byBlock.get(id) || [];
        list.push(u);
        byBlock.set(id, list);
      } catch {
        /* ignore */
      }
    }

    const pickBest = (urls: string[], kind: "image" | "audio") => {
      const filtered = urls.filter((u) =>
        kind === "audio"
          ? /\.(mp3|m4a|ogg|wav)(\?|$)/i.test(u) || /file\.notion\.so/i.test(u)
          : /\/image\//i.test(u) || /\.(png|jpe?g|webp|gif)(\?|$)/i.test(u),
      );
      if (!filtered.length) return null;
      // Prefer largest width=
      filtered.sort((a, b) => {
        const wa = Number(new URL(a).searchParams.get("width") || 0);
        const wb = Number(new URL(b).searchParams.get("width") || 0);
        return wb - wa;
      });
      return filtered[0]!;
    };

    for (const block of mediaBlocks) {
      const id = block.getAttribute("data-block-id") || "";
      const urls = byBlock.get(id) || [];
      const figure =
        block.querySelector('[role="figure"]') ||
        block.querySelector("[data-content-editable-void]") ||
        block;

      if (block.classList.contains("notion-image-block")) {
        let img = block.querySelector("img") as HTMLImageElement | null;
        const best = pickBest(urls, "image");
        if (!img && best) {
          img = document.createElement("img");
          img.alt = "";
          img.referrerPolicy = "same-origin";
          img.style.display = "block";
          img.style.width = "100%";
          img.style.maxWidth = "100%";
          img.style.height = "auto";
          figure.appendChild(img);
        }
        if (img && best && (!img.src || img.src.startsWith("data:"))) {
          img.src = best;
        }
        if (img) add(img.src);
      }

      if (block.classList.contains("notion-audio-block")) {
        let audio = block.querySelector("audio") as HTMLAudioElement | null;
        const matched = urls.find(
          (u) =>
            /\.(mp3|m4a|ogg|wav)(\?|$)/i.test(u) || /file\.notion\.so/i.test(u),
        );
        const src = matched || pickBest(urls, "audio");
        if (!audio && src) {
          audio = document.createElement("audio");
          audio.controls = true;
          audio.preload = "metadata";
          audio.style.width = "100%";
          audio.style.display = "block";
          figure.appendChild(audio);
        }
        if (audio && src) {
          audio.src = src;
          add(src);
        }
      }
    }

    await delay(400);
    return [...found];
  });
}

/**
 * Prepare the painted Notion DOM for a static host:
 * keep header chrome, strip promo CTAs, fix fixed desktop widths,
 * leave scripts out (we inject our own offline runtime instead).
 */
export async function freezeNotionPage(page: Page): Promise<string> {
  await page.evaluate(async () => {
    const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

    // Best-effort expand for any toggles still closed (primary expand is CDP)
    for (const block of Array.from(
      document.querySelectorAll(".notion-toggle-block"),
    )) {
      const btn = block.querySelector(
        '[role="button"][aria-expanded="false"]',
      ) as HTMLElement | null;
      if (btn) btn.click();
    }
    await delay(600);

    for (const img of Array.from(document.querySelectorAll("img"))) {
      const el = img as HTMLImageElement;
      const ds =
        el.getAttribute("data-src") ||
        el.getAttribute("data-lazy-src") ||
        el.getAttribute("data-original");
      if (
        ds &&
        (!el.getAttribute("src") || el.src.startsWith("data:image/svg") || el.src.startsWith("data:image/gif"))
      ) {
        el.setAttribute("src", ds);
      }
      const srcset = el.getAttribute("srcset");
      if (srcset) {
        const candidates = srcset
          .split(",")
          .map((p) => p.trim().split(/\s+/)[0]!);
        const last = candidates[candidates.length - 1];
        if (last) el.setAttribute("src", last);
      }
    }

    const absAttr = (el: Element, attr: string) => {
      const v = el.getAttribute(attr);
      if (!v || v.startsWith("data:") || v.startsWith("blob:") || v.startsWith("#"))
        return;
      try {
        el.setAttribute(attr, new URL(v, location.href).href);
      } catch {
        /* ignore */
      }
    };
    for (const el of Array.from(document.querySelectorAll("[href]")))
      absAttr(el, "href");
    for (const el of Array.from(document.querySelectorAll("[src]")))
      absAttr(el, "src");
    for (const el of Array.from(document.querySelectorAll("[poster]")))
      absAttr(el, "poster");
    for (const el of Array.from(document.querySelectorAll("audio, source, video"))) {
      absAttr(el, "src");
      const audio = el as HTMLAudioElement;
      if (el.tagName === "AUDIO") {
        audio.controls = true;
        audio.preload = "metadata";
      }
    }

    // Collapse toggles for default closed UI, but keep children in the DOM.
    // Mark content nodes so the offline runtime can show/hide reliably.
    for (const block of Array.from(
      document.querySelectorAll(".notion-toggle-block"),
    )) {
      const el = block as HTMLElement;
      el.setAttribute("data-nsp-open", "0");
      const btn = el.querySelector('[role="button"]') as HTMLElement | null;
      if (btn) {
        btn.setAttribute("aria-expanded", "false");
        btn.setAttribute("aria-label", "Open");
      }

      const contentNodes: HTMLElement[] = [];
      const kids = Array.from(el.children) as HTMLElement[];
      // Notion usually: [headerRow, ...contentBlocks]
      if (kids.length >= 2) {
        for (let i = 1; i < kids.length; i++) contentNodes.push(kids[i]!);
      }
      // Or a single wrapper whose children after the first are content
      if (!contentNodes.length && kids[0]) {
        const inner = Array.from(kids[0].children) as HTMLElement[];
        for (let i = 1; i < inner.length; i++) contentNodes.push(inner[i]!);
      }
      // Nested blocks that are siblings of the header flex row
      if (!contentNodes.length) {
        for (const child of Array.from(
          el.querySelectorAll(":scope > div > .notion-selectable, :scope > .notion-selectable"),
        ) as HTMLElement[]) {
          if (child.querySelector('[role="button"][aria-label]')) continue;
          if (child.closest(".notion-list-item-box-left")) continue;
          // Skip the header chrome that contains the title leaf
          if (child.querySelector("[data-content-editable-leaf]")) continue;
          contentNodes.push(child);
        }
      }

      for (const node of contentNodes) {
        node.setAttribute("data-nsp-toggle-content", "1");
        node.style.display = "none";
      }
    }

    // Inline accessible CSS (Notion look without remote dependency)
    const cssChunks: string[] = [];
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        const rules = sheet.cssRules;
        if (!rules) continue;
        const parts: string[] = [];
        for (const rule of Array.from(rules)) parts.push(rule.cssText);
        if (parts.length) cssChunks.push(parts.join("\n"));
      } catch {
        /* cross-origin — keep <link> */
      }
    }
    if (cssChunks.length) {
      const style = document.createElement("style");
      style.setAttribute("data-notion-static-parser", "inlined");
      // Drop print-only chrome-hiding rules Notion ships without a usable @media
      // wrapper after cssText serialization in some browsers.
      let css = cssChunks.join("\n\n");
      css = css.replace(
        /@media\s+print\s*\{[\s\S]*?\}\s*/gi,
        "/* print styles omitted */\n",
      );
      style.textContent = css;
      document.head.appendChild(style);
    }

    // Always keep the page topbar (breadcrumbs) visible offline
    const topbarFix = document.createElement("style");
    topbarFix.setAttribute("data-notion-static-parser", "topbar");
    topbarFix.textContent = `
      .notion-topbar {
        display: flex !important;
        visibility: visible !important;
        opacity: 1 !important;
        height: 44px !important;
        pointer-events: auto !important;
      }
      header {
        display: block !important;
        visibility: visible !important;
      }
    `;
    document.head.appendChild(topbarFix);

    // Strip Notion client JS (would blank the page offline). We inject nsp-runtime.
    for (const el of Array.from(
      document.querySelectorAll(
        "script, link[rel='modulepreload'], link[rel='preload'][as='script']",
      ),
    )) {
      el.remove();
    }
    for (const el of Array.from(
      document.querySelectorAll(
        "link[rel='manifest'], meta[http-equiv='Content-Security-Policy']",
      ),
    )) {
      el.remove();
    }

    for (const sel of [
      ".notion-overlay-container",
      ".notion-help-button",
      "[data-testid='exit-presentation-mode-button']",
    ]) {
      for (const el of Array.from(document.querySelectorAll(sel))) el.remove();
    }

    for (const el of Array.from(document.querySelectorAll("[contenteditable]"))) {
      el.removeAttribute("contenteditable");
      (el as HTMLElement).style.caretColor = "transparent";
    }

    // Remove promo / auth CTAs in the topbar (keep the topbar shell + breadcrumbs + ⋮)
    const promoRe =
      /^(get notion free|log in|sign up|duplicate|try notion|download|share site to socials)$/i;
    for (const el of Array.from(
      document.querySelectorAll(".notion-topbar [role='button'], .notion-topbar a"),
    )) {
      const t = (el.textContent || "").replace(/\s+/g, " ").trim();
      const label = (el.getAttribute("aria-label") || "").trim();
      if (promoRe.test(t) || promoRe.test(label)) {
        const wrap = el.closest(".xjp7ctv") || el;
        (wrap as HTMLElement).remove();
      }
    }
    // Remove topbar Search only (not collection Search)
    for (const el of Array.from(
      document.querySelectorAll(".notion-topbar [role='button']"),
    )) {
      if (el.closest(".notion-collection_view-block")) continue;
      const label = (el.getAttribute("aria-label") || "").toLowerCase();
      const svg = el.querySelector(
        "svg.magnifyingGlass, svg.magnifyingGlassSmall",
      );
      if (label === "search" || (svg && !label.includes("more"))) {
        const wrap = el.closest(".xjp7ctv") || el;
        (wrap as HTMLElement).remove();
      }
    }
    // Explicit Get Notion free text nodes
    for (const el of Array.from(document.querySelectorAll(".notion-topbar *"))) {
      const t = (el.textContent || "").replace(/\s+/g, " ").trim();
      if (t === "Get Notion free" && el.children.length === 0) {
        const btn = el.closest("[role='button']") || el;
        btn.remove();
      }
    }

    // Unlock responsive layout: Notion freezes desktop widths at scrape time
    const html = document.documentElement;
    html.style.setProperty("--full-viewport-height", "100dvh");
    html.style.removeProperty("width");

    for (const el of Array.from(
      document.querySelectorAll(".notion-frame, .notion-cursor-listener, main"),
    )) {
      const h = el as HTMLElement;
      if (h.style.width && /px$/.test(h.style.width)) {
        h.style.width = "100%";
        h.style.maxWidth = "100%";
      }
      if (h.style.height && h.style.height.includes("100vh")) {
        h.style.height = "calc(-44px + 100dvh)";
      }
    }

    document.documentElement.style.overflow = "auto";
    document.body.style.overflow = "auto";
    document.body.style.height = "auto";
    document.body.style.width = "100%";
    document.body.style.maxWidth = "100%";

    await delay(50);
  });

  return page.content();
}

/** Wait until the live Notion UI shell + page content are painted. */
export async function waitForLiveNotionUi(page: Page): Promise<void> {
  await page
    .waitForFunction(
      () => {
        const app =
          document.querySelector(".notion-app-inner") ||
          document.querySelector("#notion-app") ||
          document.querySelector(".notion-frame");
        const content =
          document.querySelector(".notion-page-content") ||
          document.querySelector(".notion-collection-view-body") ||
          document.querySelector(".notion-page-block") ||
          document.querySelector("[data-block-id]");
        const text = (document.body?.innerText || "").trim();
        return Boolean(app && content) || text.length > 80;
      },
      { timeout: 90_000 },
    )
    .catch(() => {
      /* continue */
    });
}
