import { createHash } from "node:crypto";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import type { Page } from "puppeteer";
import type { AssetStore } from "./assets.ts";
import { normalizeAssetKey } from "./assets.ts";

export const CACHE_VERSION = 1 as const;
export const CACHE_FILE = ".nsp-cache.json";

export type PageCacheEntry = {
  url: string;
  file: string;
  fingerprint: string;
  links: string[];
};

export type SyncCache = {
  version: typeof CACHE_VERSION;
  rootUrl: string;
  pages: Record<string, PageCacheEntry>;
  /** Normalized asset URL → relative path under site root (e.g. assets/abc.png) */
  assets: Record<string, string>;
};

export function stagingDir(outRoot: string): string {
  return `${outRoot.replace(/\/$/, "")}.nsp-staging`;
}

export function backupDir(outRoot: string): string {
  return `${outRoot.replace(/\/$/, "")}.nsp-backup`;
}

export function emptyCache(rootUrl: string): SyncCache {
  return { version: CACHE_VERSION, rootUrl, pages: {}, assets: {} };
}

export function loadCache(dir: string): SyncCache | null {
  const path = join(dir, CACHE_FILE);
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as SyncCache;
    if (!raw || raw.version !== CACHE_VERSION || !raw.pages) return null;
    if (!raw.assets) raw.assets = {};
    return raw;
  } catch {
    return null;
  }
}

export function saveCache(dir: string, cache: SyncCache): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, CACHE_FILE), JSON.stringify(cache, null, 2), "utf8");
}

/** Seed asset store from a previous cache so downloads/rewrites can reuse files. */
export function hydrateAssetStore(store: AssetStore, cache: SyncCache): number {
  let n = 0;
  for (const [url, rel] of Object.entries(cache.assets)) {
    const key = normalizeAssetKey(url);
    if (store.map.has(key)) continue;
    const abs = join(store.outRoot, rel);
    if (!existsSync(abs)) continue;
    store.map.set(key, rel);
    store.map.set(url, rel);
    store.reverse.set(rel, key);
    n += 1;
  }
  return n;
}

export function snapshotAssets(store: AssetStore): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [url, rel] of store.map) {
    // Prefer normalized keys only
    if (url !== normalizeAssetKey(url)) continue;
    out[url] = rel;
  }
  return out;
}

/**
 * Light content fingerprint after Notion has rendered.
 * Avoids re-freezing / re-downloading when the page body is unchanged.
 */
export async function pageFingerprint(page: Page): Promise<string> {
  const raw = await page.evaluate(() => {
    const root =
      document.querySelector("main#main") ||
      document.querySelector(".notion-page-content") ||
      document.querySelector("#notion-app") ||
      document.body;
    if (!root) return "";
    const ids = Array.from(root.querySelectorAll("[data-block-id]"))
      .map((el) => el.getAttribute("data-block-id") || "")
      .filter(Boolean)
      .join(",");
    let text = (root as HTMLElement).innerText || "";
    // Strip common volatile Notion chrome
    text = text
      .replace(/\bEdited\s+.+$/gim, "")
      .replace(/\bLast edited\s+.+$/gim, "")
      .replace(/\s+/g, " ")
      .trim();
    const title = document.title || "";
    return `${title}\n${ids}\n${text}`;
  });
  return createHash("sha256").update(raw).digest("hex");
}

export function siteHasContent(dir: string): boolean {
  if (!existsSync(dir)) return false;
  try {
    return readdirSync(dir).some((name) => {
      if (name === ".git" || name === ".github") return false;
      return true;
    });
  } catch {
    return false;
  }
}

/**
 * Prepare a clean staging directory.
 * Copies assets + cache + a few root files (fast). HTML is copied on demand
 * for cache hits, or written fresh when a page is re-scraped.
 */
export function prepareStaging(
  outRoot: string,
  keepCname?: boolean,
): { staging: string; copied: boolean } {
  const staging = stagingDir(outRoot);
  if (existsSync(staging)) {
    rmSync(staging, { recursive: true, force: true });
  }
  mkdirSync(staging, { recursive: true });
  mkdirSync(join(staging, "assets"), { recursive: true });

  let copied = false;
  if (siteHasContent(outRoot)) {
    const assetsSrc = join(outRoot, "assets");
    if (existsSync(assetsSrc)) {
      cpSync(assetsSrc, join(staging, "assets"), { recursive: true });
      copied = true;
    }
    // Carry PWA / cache / icons into staging
    for (const name of [
      CACHE_FILE,
      "manifest.webmanifest",
      "sw.js",
      "CNAME",
    ]) {
      const src = join(outRoot, name);
      if (existsSync(src)) {
        copyFileSync(src, join(staging, name));
        copied = true;
      }
    }
  }

  if (keepCname) {
    const cnameSrc = join(outRoot, "CNAME");
    if (existsSync(cnameSrc)) {
      writeFileSync(join(staging, "CNAME"), readFileSync(cnameSrc));
    }
  }

  return { staging, copied };
}

/** Ensure a previously scraped HTML page exists in staging (for cache hits). */
export function ensureCachedPageInStaging(
  outRoot: string,
  staging: string,
  file: string,
): boolean {
  const dest = join(staging, file);
  if (existsSync(dest)) return true;
  const src = join(outRoot, file);
  if (!existsSync(src)) return false;
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(src, dest);
  return true;
}

/**
 * Atomically publish staging → outRoot, keeping one previous copy at backup.
 * Live outRoot is never wiped until staging is complete.
 */
export function publishStaging(outRoot: string): { backup: string | null } {
  const staging = stagingDir(outRoot);
  const backup = backupDir(outRoot);

  if (!existsSync(staging)) {
    throw new Error(`Staging missing: ${staging}`);
  }

  if (existsSync(backup)) {
    rmSync(backup, { recursive: true, force: true });
  }

  if (siteHasContent(outRoot)) {
    // Rename is atomic on same filesystem; fall back to copy+rm if needed
    try {
      renameSync(outRoot, backup);
    } catch {
      cpSync(outRoot, backup, { recursive: true });
      rmSync(outRoot, { recursive: true, force: true });
    }
  }

  try {
    renameSync(staging, outRoot);
  } catch {
    mkdirSync(dirname(outRoot), { recursive: true });
    cpSync(staging, outRoot, { recursive: true });
    rmSync(staging, { recursive: true, force: true });
  }

  return { backup: existsSync(backup) ? backup : null };
}

/** Restore the single backup over outRoot (if present). */
export function restoreBackup(outRoot: string): boolean {
  const backup = backupDir(outRoot);
  if (!existsSync(backup) || !siteHasContent(backup)) return false;
  const staging = stagingDir(outRoot);
  if (existsSync(staging)) {
    rmSync(staging, { recursive: true, force: true });
  }
  // Move current aside briefly, then put backup in place
  const doomed = `${outRoot}.nsp-restore-old`;
  if (existsSync(outRoot)) {
    if (existsSync(doomed)) rmSync(doomed, { recursive: true, force: true });
    try {
      renameSync(outRoot, doomed);
    } catch {
      cpSync(outRoot, doomed, { recursive: true });
      rmSync(outRoot, { recursive: true, force: true });
    }
  }
  try {
    renameSync(backup, outRoot);
  } catch {
    cpSync(backup, outRoot, { recursive: true });
    rmSync(backup, { recursive: true, force: true });
  }
  if (existsSync(doomed)) {
    rmSync(doomed, { recursive: true, force: true });
  }
  return true;
}

/** Remove HTML pages in staging that were not part of this crawl. */
export function pruneOrphanHtml(
  staging: string,
  keepFiles: Set<string>,
): number {
  let removed = 0;
  for (const name of readdirSync(staging)) {
    if (!name.endsWith(".html")) continue;
    if (keepFiles.has(name)) continue;
    rmSync(join(staging, name), { force: true });
    removed += 1;
  }
  return removed;
}
