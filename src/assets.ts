import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import type { HTTPResponse, Page } from "puppeteer";
import {
  extractPageId,
  extFromContentType,
  isNotionSiteHost,
  normalizeBlockId,
  sniffExt,
} from "./urls.ts";

export type AssetStore = {
  map: Map<string, string>;
  /** relative asset path → source URL(s) */
  reverse: Map<string, string>;
  dir: string;
  outRoot: string;
};

export function createAssetStore(outRoot: string): AssetStore {
  const dir = join(outRoot, "assets");
  mkdirSync(dir, { recursive: true });
  return { map: new Map(), reverse: new Map(), dir, outRoot };
}

function hashUrl(url: string): string {
  return createHash("sha1").update(url).digest("hex").slice(0, 16);
}

function toPosix(p: string): string {
  return p.split(sep).join("/");
}

export function normalizeAssetKey(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    return u.href;
  } catch {
    return url;
  }
}

/** Notion page URLs must never be saved as static assets. */
export function isNotionPageAssetUrl(url: string): boolean {
  try {
    const u = new URL(url.replace(/&amp;/g, "&"));
    if (!isNotionSiteHost(u.hostname)) return false;
    if (/\/image\//i.test(u.pathname)) return false;
    if (/\/(image|file|secure\.notion)/i.test(u.pathname)) return false;
    return Boolean(extractPageId(u.href));
  } catch {
    return false;
  }
}

function looksLikeHtml(body: Buffer, contentType: string | null): boolean {
  const ct = (contentType || "").toLowerCase();
  if (ct.includes("text/html") || ct.includes("application/xhtml")) return true;
  const head = body.subarray(0, 64).toString("utf8").trimStart().toLowerCase();
  return (
    head.startsWith("<!doctype html") ||
    head.startsWith("<html") ||
    head.startsWith("<head") ||
    head.includes("just a moment")
  );
}

export function saveAsset(
  store: AssetStore,
  url: string,
  body: Buffer,
  contentType: string | null,
): string | null {
  const key = normalizeAssetKey(url.replace(/&amp;/g, "&"));
  const existing = store.map.get(key);
  if (existing) return existing;

  if (isNotionPageAssetUrl(key)) return null;
  if (looksLikeHtml(body, contentType)) return null;
  if (body.length < 8) return null;

  const sniffed = sniffExt(body);
  const fromMeta = extFromContentType(contentType, url);
  // Prefer magic-byte sniff over path (Notion CDN paths often lie)
  const ext = sniffed || fromMeta || ".bin";
  if (ext === ".bin" && !contentType) return null;

  const name = `${hashUrl(key)}${ext}`;
  const abs = join(store.dir, name);
  writeFileSync(abs, body);
  const rel = toPosix(join("assets", name));
  store.map.set(key, rel);
  store.map.set(url, rel);
  store.reverse.set(rel, key);
  return rel;
}

export async function downloadUrl(
  store: AssetStore,
  url: string,
  page: Page,
): Promise<string | null> {
  const clean = url.replace(/&amp;/g, "&");
  const key = normalizeAssetKey(clean);
  if (store.map.has(key)) return store.map.get(key)!;
  if (clean.startsWith("data:") || clean.startsWith("blob:")) return null;
  if (isNotionPageAssetUrl(clean)) return null;
  if (/\.js(\?|$)/i.test(clean) && !/\/image\//i.test(clean)) return null;

  const fromPage = await fetchInPage(page, clean);
  if (fromPage) {
    const saved = saveAsset(store, clean, fromPage.body, fromPage.ct);
    if (saved) return saved;
  }

  const fromNode = await fetchWithCookies(page, clean);
  if (fromNode) {
    return saveAsset(store, clean, fromNode.body, fromNode.ct);
  }
  return null;
}

async function fetchInPage(
  page: Page,
  url: string,
): Promise<{ body: Buffer; ct: string | null } | null> {
  try {
    const res = await page.evaluate(async (u) => {
      const r = await fetch(u, { credentials: "include" });
      if (!r.ok) return null;
      const ct = r.headers.get("content-type");
      const buf = await r.arrayBuffer();
      return { ct, bytes: Array.from(new Uint8Array(buf)) };
    }, url);
    if (!res) return null;
    return { body: Buffer.from(res.bytes), ct: res.ct };
  } catch {
    return null;
  }
}

async function fetchWithCookies(
  page: Page,
  url: string,
): Promise<{ body: Buffer; ct: string | null } | null> {
  try {
    const cookies = await page.cookies(url);
    const cookie = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
    const referer = page.url();
    const res = await fetch(url, {
      headers: {
        Cookie: cookie,
        Referer: referer,
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      },
      redirect: "follow",
    });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type");
    const body = Buffer.from(await res.arrayBuffer());
    return { body, ct };
  } catch {
    return null;
  }
}

export function attachResponseCollector(page: Page): {
  urls: Set<string>;
  responses: Map<string, HTTPResponse>;
  detach: () => void;
} {
  const urls = new Set<string>();
  const responses = new Map<string, HTTPResponse>();
  const onResponse = (res: HTTPResponse) => {
    const type = res.request().resourceType();
    if (
      !["stylesheet", "image", "font", "media", "other"].includes(type)
    ) {
      return;
    }
    const url = res.url();
    if (!url.startsWith("http") || !res.ok()) return;
    const ct = res.headers()["content-type"] ?? "";
    if (ct.includes("text/html")) return;
    if (isNotionPageAssetUrl(url)) return;
    urls.add(url);
    responses.set(normalizeAssetKey(url), res);
  };
  page.on("response", onResponse);
  return {
    urls,
    responses,
    detach: () => page.off("response", onResponse),
  };
}

/** Persist bodies Chrome already fetched (best source for images/fonts). */
export async function saveCollectedResponses(
  store: AssetStore,
  responses: Map<string, HTTPResponse>,
): Promise<void> {
  for (const [key, res] of responses) {
    if (store.map.has(key)) continue;
    try {
      const body = await res.buffer();
      const ct = res.headers()["content-type"] ?? null;
      saveAsset(store, res.url(), body, ct);
    } catch {
      /* body discarded — downloadUrl will retry */
    }
  }
}

export async function downloadAssetUrls(
  store: AssetStore,
  page: Page,
  urls: Iterable<string>,
  concurrency = 6,
): Promise<void> {
  const pending: string[] = [];
  const seen = new Set<string>();
  for (const url of urls) {
    const clean = url.replace(/&amp;/g, "&");
    const key = normalizeAssetKey(clean);
    if (seen.has(key)) continue;
    seen.add(key);
    if (store.map.has(key)) continue;
    if (isNotionPageAssetUrl(clean)) continue;
    if (/\.js(\?|$)/i.test(clean) && !/\/image\//i.test(clean)) continue;
    pending.push(clean);
  }
  if (!pending.length) return;

  const limit = Math.max(1, concurrency);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, pending.length) }, async () => {
    while (i < pending.length) {
      const idx = i++;
      const url = pending[idx]!;
      await downloadUrl(store, url, page);
    }
  });
  await Promise.all(workers);
}

export async function collectDomAssetUrls(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out = new Set<string>();
    const add = (u: string | null | undefined) => {
      if (!u) return;
      try {
        const abs = new URL(u, location.href).href;
        if (abs.startsWith("http")) out.add(abs);
      } catch {
        /* ignore */
      }
    };

    for (const el of document.querySelectorAll(
      "img[src], source[src], video[src], audio[src], link[href], use[href]",
    )) {
      add(el.getAttribute("src"));
      if (el.tagName === "LINK" || el.tagName === "USE" || el.hasAttribute("href")) {
        add(el.getAttribute("href"));
      }
    }
    // Notion audio sometimes stores URL on nested source only after expand
    for (const el of document.querySelectorAll(".notion-audio-block [src], audio source")) {
      add(el.getAttribute("src"));
    }
    for (const el of document.querySelectorAll("[srcset]")) {
      for (const part of (el.getAttribute("srcset") ?? "").split(",")) {
        add(part.trim().split(/\s+/)[0]);
      }
    }
    for (const el of document.querySelectorAll("[style*='url(']")) {
      const style = el.getAttribute("style") ?? "";
      for (const m of style.matchAll(/url\((['"]?)([^)'"]+)\1\)/g)) {
        add(m[2]);
      }
    }
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        for (const rule of Array.from(sheet.cssRules || [])) {
          for (const m of rule.cssText.matchAll(/url\((['"]?)([^)'"]+)\1\)/g)) {
            add(m[2]);
          }
        }
      } catch {
        /* ignore */
      }
    }
    return [...out];
  });
}

function basename(p: string): string {
  return p.split("/").pop() || p;
}

export function rewriteHtml(
  html: string,
  pageLocalPath: string,
  pageUrl: string,
  store: AssetStore,
  pageUrlMap: Map<string, string>,
): string {
  const pageDir = dirname(pageLocalPath) === "." ? "" : dirname(pageLocalPath);

  const idToLocal = new Map<string, string>();
  for (const [remote, local] of pageUrlMap) {
    const id = extractPageId(remote);
    if (id && !idToLocal.has(id)) idToLocal.set(id, local);
  }

  const relTo = (targetFromRoot: string): string => {
    let rel = relative(pageDir, targetFromRoot);
    if (!rel) rel = basename(targetFromRoot);
    rel = toPosix(rel);
    if (!rel.startsWith(".") && !rel.startsWith("/")) rel = `./${rel}`;
    return rel;
  };

  const lookupAsset = (abs: string): string | null => {
    const clean = abs.replace(/&amp;/g, "&");
    for (const v of [clean, abs, normalizeAssetKey(clean)]) {
      const hit = store.map.get(v);
      if (hit) return hit;
    }
    try {
      const u = new URL(clean);
      // Match same pathname ignoring volatile query params where possible
      const pathKey = `${u.origin}${u.pathname}`;
      for (const [k, v] of store.map) {
        if (k.startsWith(pathKey) || pathKey.startsWith(k.split("?")[0]!)) return v;
      }
      // Notion image URLs often differ by width= — match on attachment key
      const attach = u.pathname.match(/\/image\/(attachment[^/]*)/i);
      if (attach) {
        const needle = attach[1]!;
        for (const [k, v] of store.map) {
          if (k.includes(needle)) return v;
        }
      }
      // file.notion.so / signed file URLs: match shared UUID folder or filename
      const uuids = u.pathname.match(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
      );
      if (uuids) {
        for (const id of uuids) {
          for (const [k, v] of store.map) {
            if (k.includes(id)) return v;
          }
        }
      }
      const file = decodeURIComponent(u.pathname.split("/").pop() || "");
      if (file && /\.(mp3|m4a|wav|ogg|mp4|webm|png|jpe?g|webp|gif|svg|pdf)$/i.test(file)) {
        for (const [k, v] of store.map) {
          if (k.includes(file)) return v;
        }
      }
    } catch {
      /* ignore */
    }
    return null;
  };

  const pageLocalFor = (abs: string): string | null => {
    const id = extractPageId(abs);
    if (id && idToLocal.has(id)) return idToLocal.get(id)!;
    try {
      const u = new URL(abs);
      const clean = `${u.origin}${u.pathname.replace(/\/$/, "")}`;
      for (const [remote, local] of pageUrlMap) {
        if (remote === clean || remote === abs.split("?")[0]) return local;
      }
    } catch {
      /* ignore */
    }
    return null;
  };

  const isImagePath = (abs: string): boolean => {
    try {
      return /\/image\//i.test(new URL(abs).pathname);
    } catch {
      return /\/image\//i.test(abs);
    }
  };

  /** Fix previously-written ./assets/*.bin that were actually pages */
  const remapRelative = (val: string): string | null => {
    const cleaned = val.replace(/^\.\//, "");
    if (!cleaned.startsWith("assets/")) return null;
    const src = store.reverse.get(cleaned) || store.reverse.get(val);
    if (!src) return null;
    const pageLocal = pageLocalFor(src);
    if (pageLocal) return relTo(pageLocal);
    return null;
  };

  const rewriteAbs = (raw: string): string | null => {
    let abs: string;
    try {
      abs = new URL(raw.replace(/&amp;/g, "&"), pageUrl).href;
    } catch {
      return null;
    }

    // Images / files / audio → assets only (never page map)
    if (
      isImagePath(abs) ||
      /\/file\//i.test(abs) ||
      /file\.notion\.so/i.test(abs) ||
      /\.(mp3|m4a|wav|ogg|mp4|webm)(\?|$)/i.test(abs)
    ) {
      const asset = lookupAsset(abs);
      return asset ? relTo(asset) : abs; // keep absolute https if not downloaded
    }

    const pageId = extractPageId(abs);
    if (pageId || isNotionPageAssetUrl(abs)) {
      const pageLocal = pageLocalFor(abs);
      if (pageLocal) return relTo(pageLocal);
      // Keep absolute so rewriteAllPages can fix once pageUrlMap is complete.
      // Never collapse to "#".
      return abs;
    }

    const asset = lookupAsset(abs);
    return asset ? relTo(asset) : null;
  };

  // Protect original-url attribute from being rewritten to a local path
  const originalSlots: string[] = [];
  let out = html.replace(
    /(\sdata-nsp-original-url=")([^"]*)(")/gi,
    (_m, a: string, val: string, b: string) => {
      const i = originalSlots.length;
      originalSlots.push(val);
      return `${a}__NSP_ORIGINAL_${i}__${b}`;
    },
  );

  out = out.replace(
    /\b(href|src|poster)=["']([^"']+)["']/gi,
    (full, attr: string, val: string) => {
      if (val.startsWith("data:") || val.startsWith("mailto:")) return full;
      // Recover dead "#" later via data-block-id pass
      if (val === "#") return full;
      if (val.startsWith("#") && !val.includes("/")) return full; // #main etc.

      if (val.startsWith("./") || val.startsWith("../")) {
        const fixed = remapRelative(val);
        if (fixed) return `${attr}="${fixed}"`;
        return full;
      }
      const local = rewriteAbs(val);
      if (local) return `${attr}="${local}"`;
      return full;
    },
  );

  out = out.replace(/\bsrcset=["']([^"']+)["']/gi, (_full, val: string) => {
    const parts = val.split(",").map((part) => {
      const bits = part.trim().split(/\s+/);
      const u = bits[0]!;
      const rest = bits.slice(1).join(" ");
      if (u.startsWith("./") || u.startsWith("../")) {
        const fixed = remapRelative(u);
        if (fixed) return rest ? `${fixed} ${rest}` : fixed;
        return part.trim();
      }
      const local = rewriteAbs(u);
      if (local) return rest ? `${local} ${rest}` : local;
      return part.trim();
    });
    return `srcset="${parts.join(", ")}"`;
  });

  out = out.replace(/url\((['"]?)([^)'"]+)\1\)/gi, (full, quote: string, val: string) => {
    if (val.startsWith("data:") || val.startsWith("./") || val.startsWith("../")) {
      return full;
    }
    const local = rewriteAbs(val);
    return local ? `url(${quote}${local}${quote})` : full;
  });

  // Recover href="#" using nearest ancestor data-block-id (Notion page blocks)
  out = repairDeadPageLinks(out, pageUrlMap, pageLocalPath);

  // Restore protected original URLs
  out = out.replace(/__NSP_ORIGINAL_(\d+)__/g, (_m, i: string) => {
    return originalSlots[Number(i)] ?? "";
  });

  return out;
}

/** Fix <a href="#"> using the enclosing element's data-block-id when it matches a scraped page. */
export function repairDeadPageLinks(
  html: string,
  pageUrlMap: Map<string, string>,
  pageLocalPath: string,
): string {
  const pageDir = dirname(pageLocalPath) === "." ? "" : dirname(pageLocalPath);
  const idToLocal = new Map<string, string>();
  for (const [remote, local] of pageUrlMap) {
    const id = extractPageId(remote);
    if (id && !idToLocal.has(id)) idToLocal.set(id, local);
  }
  if (!idToLocal.size) return html;

  const relTo = (targetFromRoot: string): string => {
    let rel = relative(pageDir, targetFromRoot);
    if (!rel) rel = basename(targetFromRoot);
    rel = toPosix(rel);
    if (!rel.startsWith(".") && !rel.startsWith("/")) rel = `./${rel}`;
    return rel;
  };

  // Walk forward; remember last page-like data-block-id; rewrite href="#" under it.
  const chunks = html.split(/(?=<[^>]*\bdata-block-id=)/i);
  let activeHref: string | null = null;
  return chunks
    .map((chunk) => {
      const m = chunk.match(/\bdata-block-id=["']([^"']+)["']/i);
      if (m) {
        const id = normalizeBlockId(m[1]!);
        // Only switch when this block id maps to a scraped page (ignore columns etc.)
        if (id && idToLocal.has(id)) {
          activeHref = relTo(idToLocal.get(id)!);
        }
      }
      if (!activeHref) return chunk;
      return chunk.replace(
        /(<a\b[^>]*?\bhref=["'])#(["'])/gi,
        `$1${activeHref}$2`,
      );
    })
    .join("");
}

export function rewriteCssFiles(store: AssetStore, pageUrl: string): void {
  const done = new Set<string>();
  for (const [, rel] of store.map) {
    if (!rel.endsWith(".css") || done.has(rel)) continue;
    done.add(rel);
    const abs = join(store.outRoot, rel);
    let css = readFileSync(abs, "utf8");
    const pageDir = dirname(rel);
    css = css.replace(/url\((['"]?)([^)'"]+)\1\)/gi, (full, quote: string, val: string) => {
      if (val.startsWith("data:")) return full;
      try {
        const absUrl = new URL(val, pageUrl).href;
        const mapped = store.map.get(normalizeAssetKey(absUrl));
        if (!mapped) return full;
        let r = toPosix(relative(pageDir, mapped));
        if (!r.startsWith(".")) r = `./${r}`;
        return `url(${quote}${r}${quote})`;
      } catch {
        return full;
      }
    });
    writeFileSync(abs, css);
  }
}

export function findRemainingRemoteUrls(html: string, baseUrl?: string): string[] {
  const out = new Set<string>();
  const add = (raw: string) => {
    let u = raw.replace(/&amp;/g, "&");
    if (/w3\.org/i.test(u)) return;
    if (u.startsWith("/") && baseUrl) {
      try {
        u = new URL(u, baseUrl).href;
      } catch {
        return;
      }
    }
    if (!/^https?:\/\//i.test(u)) return;
    if (isNotionPageAssetUrl(u)) return;
    if (/\.js(\?|$)/i.test(u) && !/\/image\//i.test(u)) return;
    out.add(u);
  };

  for (const m of html.matchAll(/https?:\/\/[^"'\s)<]+/gi)) {
    add(m[0]!);
  }
  // Relative Notion image / page-asset paths inside collection snapshots
  for (const m of html.matchAll(
    /(?:src|href)=["'](\/image\/[^"']+)["']/gi,
  )) {
    add(m[1]!);
  }
  for (const m of html.matchAll(/url\((['"]?)(\/image\/[^)'"]+)\1\)/gi)) {
    add(m[2]!);
  }
  return [...out];
}

/** Map Notion block UUID (32-hex) → best local audio/image asset path. */
export function buildBlockAssetIndex(
  entries: Iterable<[string, string]>,
): Map<string, { audio?: string; image?: string; imageWidth: number }> {
  const index = new Map<
    string,
    { audio?: string; image?: string; imageWidth: number }
  >();
  for (const [remote, rel] of entries) {
    let blockId: string | null = null;
    let width = 0;
    try {
      const u = new URL(remote.replace(/&amp;/g, "&"));
      blockId = normalizeBlockId(u.searchParams.get("id"));
      width = Number(u.searchParams.get("width") || 0) || 0;
    } catch {
      continue;
    }
    if (!blockId) continue;
    const entry = index.get(blockId) || { imageWidth: 0 };
    const isAudio =
      /\.(mp3|m4a|ogg|wav|aac)(\?|$)/i.test(remote) ||
      /\.(mp3|m4a|ogg|wav|aac)$/i.test(rel);
    const isImage =
      /\/image\//i.test(remote) ||
      /\.(png|jpe?g|webp|gif|svg)$/i.test(rel);
    if (isAudio) entry.audio = rel;
    if (isImage && (!entry.image || width >= entry.imageWidth)) {
      entry.image = rel;
      entry.imageWidth = width;
    }
    index.set(blockId, entry);
  }
  return index;
}

/**
 * Inject <audio> into empty Notion audio blocks and replace gif placeholders
 * using assets keyed by ?id=<blockId> in the CDN URL.
 */
export function injectBlockMedia(
  html: string,
  store: AssetStore,
  pageLocalPath: string,
): string {
  const index = buildBlockAssetIndex(store.map.entries());
  if (!index.size) return html;

  const pageDir = dirname(pageLocalPath) === "." ? "" : dirname(pageLocalPath);
  const relTo = (targetFromRoot: string): string => {
    let rel = relative(pageDir, targetFromRoot);
    if (!rel) rel = basename(targetFromRoot);
    rel = toPosix(rel);
    if (!rel.startsWith(".") && !rel.startsWith("/")) rel = `./${rel}`;
    return rel;
  };

  // Audio: fill empty custom player shells
  html = html.replace(
    /(<div\b[^>]*data-block-id="([^"]+)"[^>]*notion-audio-block[^>]*>)([\s\S]*?)(<\/div>\s*<\/div>\s*<\/div>)/gi,
    (full, open: string, id: string, mid: string, close: string) => {
      if (/<audio\b/i.test(mid)) return full;
      const entry = index.get(normalizeBlockId(id) || "");
      if (!entry?.audio) return full;
      const src = relTo(entry.audio);
      const player =
        `<audio controls preload="metadata" src="${src}" ` +
        `style="width:100%;max-width:100%;display:block"></audio>`;
      // Prefer replacing empty figure; otherwise append before close
      if (/role="figure"/i.test(mid) && !/<audio\b/i.test(mid)) {
        const filled = mid.replace(
          /(<div\b[^>]*role="figure"[^>]*>)(\s*)(<\/div>)/i,
          `$1${player}$3`,
        );
        return open + filled + close;
      }
      return open + mid + player + close;
    },
  );

  // Images: data: gif/svg placeholders → local asset for that block
  html = html.replace(
    /(<div\b[^>]*data-block-id="([^"]+)"[^>]*notion-image-block[^>]*>[\s\S]*?<img\b[^>]*\bsrc=")data:image\/(?:gif|svg\+xml)[^"]*/gi,
    (full, prefix: string, id: string) => {
      const entry = index.get(normalizeBlockId(id) || "");
      if (!entry?.image) return full;
      return prefix + relTo(entry.image);
    },
  );

  return html;
}

export function ensureParentDir(filePath: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
}
