/** Notion public URL helpers */

const PAGE_ID_RE = /([0-9a-f]{32})$/i;
const UUID_RE =
  /([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})/i;

export function isNotionSiteHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return h.endsWith(".notion.site") || h === "notion.site" || h === "www.notion.so" || h === "notion.so";
}

/** Extract 32-char page id (no dashes) from a Notion page URL path (not image/query ids). */
export function extractPageId(input: string): string | null {
  try {
    const u = new URL(input, "https://placeholder.local");
    // Image/file CDN paths embed block UUIDs in query — never treat as page ids
    if (/\/(image|file)\//i.test(u.pathname)) return null;
    const path = decodeURIComponent(u.pathname);
    const fromPath = path.match(PAGE_ID_RE);
    if (fromPath) return fromPath[1]!.toLowerCase();
    const uuid = path.match(UUID_RE);
    if (uuid) {
      return `${uuid[1]}${uuid[2]}${uuid[3]}${uuid[4]}${uuid[5]}`.toLowerCase();
    }
    const hash = u.hash.replace(/^#/, "");
    const fromHash = hash.match(PAGE_ID_RE) || hash.match(UUID_RE);
    if (fromHash && fromHash[0].includes("-")) {
      return fromHash[0].replace(/-/g, "").toLowerCase();
    }
    if (fromHash) return fromHash[1]?.toLowerCase() ?? fromHash[0].toLowerCase();
  } catch {
    /* fall through */
  }
  // Only bare-match path-like strings, never full URLs with query (avoids image ?id=)
  if (/^https?:\/\//i.test(input) || input.includes("?")) return null;
  const bare = input.replace(/-/g, "").match(/([0-9a-f]{32})/i);
  return bare ? bare[1]!.toLowerCase() : null;
}

/** Normalize a Notion block/page UUID to 32-char hex. */
export function normalizeBlockId(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const hex = raw.replace(/-/g, "").toLowerCase();
  return /^[0-9a-f]{32}$/.test(hex) ? hex : null;
}

/** Canonical crawl key for a page (host + page id). */
export function pageKey(url: string): string | null {
  try {
    const u = new URL(url);
    const id = extractPageId(url);
    if (!id) return null;
    return `${u.hostname.toLowerCase()}::${id}`;
  } catch {
    return null;
  }
}

/**
 * Normalize a same-site Notion page URL for crawling:
 * keep origin + pathname (drop query/hash that don't change the page).
 */
export function normalizePageUrl(raw: string, base?: string): string | null {
  try {
    const u = new URL(raw, base);
    if (!isNotionSiteHost(u.hostname)) return null;
    const id = extractPageId(u.href);
    if (!id) return null;
    // Prefer path without trailing slash noise
    let path = u.pathname;
    if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
    return `${u.origin}${path}`;
  } catch {
    return null;
  }
}

export function siteOrigin(url: string): string {
  return new URL(url).origin;
}

export function sameSite(a: string, b: string): boolean {
  try {
    return new URL(a).hostname === new URL(b).hostname;
  } catch {
    return false;
  }
}

/** Safe filename stem from page title + id. */
export function pageFileStem(title: string, pageId: string): string {
  const clean = title
    .normalize("NFKD")
    .replace(/[^\w\s\-]+/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 80);
  const base = clean || "page";
  return `${base}-${pageId}`;
}

export function extFromContentType(ct: string | null, url: string): string {
  if (ct) {
    const t = ct.split(";")[0]!.trim().toLowerCase();
    const map: Record<string, string> = {
      "text/css": ".css",
      "text/javascript": ".js",
      "application/javascript": ".js",
      "application/x-javascript": ".js",
      "image/png": ".png",
      "image/jpeg": ".jpg",
      "image/jpg": ".jpg",
      "image/gif": ".gif",
      "image/webp": ".webp",
      "image/svg+xml": ".svg",
      "image/x-icon": ".ico",
      "font/woff": ".woff",
      "font/woff2": ".woff2",
      "application/font-woff": ".woff",
      "application/font-woff2": ".woff2",
      "application/octet-stream": "",
      "audio/mpeg": ".mp3",
      "audio/mp3": ".mp3",
      "audio/mp4": ".m4a",
      "audio/wav": ".wav",
      "audio/x-wav": ".wav",
      "audio/webm": ".webm",
      "audio/ogg": ".ogg",
      "video/mp4": ".mp4",
      "application/json": ".json",
    };
    if (map[t]) return map[t]!;
    if (t.includes("text/html")) return "";
  }

  const path = (() => {
    try {
      return new URL(url).pathname;
    } catch {
      return url;
    }
  })();
  const fromPath = path.match(/\.([a-z0-9]{1,5})(?:$|\?)/i);
  if (fromPath) return `.${fromPath[1]!.toLowerCase()}`;
  return "";
}

/** Detect real file type from magic bytes (avoids saving CF HTML as .png/.woff). */
export function sniffExt(body: Buffer): string | null {
  if (body.length < 4) return null;
  if (body[0] === 0x89 && body[1] === 0x50 && body[2] === 0x4e && body[3] === 0x47) {
    return ".png";
  }
  if (body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff) return ".jpg";
  if (
    body[0] === 0x47 &&
    body[1] === 0x49 &&
    body[2] === 0x46 &&
    body[3] === 0x38
  ) {
    return ".gif";
  }
  if (
    body[0] === 0x52 &&
    body[1] === 0x49 &&
    body[2] === 0x46 &&
    body[3] === 0x46 &&
    body.length > 11 &&
    body.toString("ascii", 8, 12) === "WEBP"
  ) {
    return ".webp";
  }
  if (body[0] === 0x00 && body[1] === 0x01 && body[2] === 0x00 && body[3] === 0x00) {
    return ".ttf";
  }
  if (body[0] === 0x77 && body[1] === 0x4f && body[2] === 0x46 && body[3] === 0x32) {
    return ".woff2";
  }
  if (body[0] === 0x77 && body[1] === 0x4f && body[2] === 0x46 && body[3] === 0x46) {
    return ".woff";
  }
  const head = body.subarray(0, 256).toString("utf8").trimStart();
  if (head.startsWith("<svg") || head.startsWith("<?xml")) return ".svg";
  if (/^@font-face|^\/\*|:root|\.notion/i.test(head)) return ".css";
  return null;
}
