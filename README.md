# notion-static-parser

Scrape a **public** Notion site (`*.notion.site`) into a static mirror that looks
like the **live Notion UI** — not Notion’s admin “Export → HTML” look.

Compare:

- Live UI (target): https://almond-brownie-c82.notion.site/Elementary-3b515e0e4a098053bb74c985cebfd777
- Old export style (different UI): https://elementary.english.orlov.app/

This tool freezes the painted Notion SPA (HTML + CSS + fonts + images), strips
client JS that would blank the page offline, rewrites links, and writes files
you can host on GitHub Pages (installable PWA with offline cache).

No Notion API token. Exhaustive BFS: every same-site link on every page is
queued until the tree is done.

```bash
bunx notion-static-parser sync \
  --url "https://almond-brownie-c82.notion.site/Elementary-3b515e0e4a098053bb74c985cebfd777" \
  --out ./_site
```

## Install / run

```bash
bunx notion-static-parser sync --url "https://….notion.site/…" --out ./_site
bun add -g notion-static-parser
notion-static-parser sync --url "…" --out ./_site
```

Optional config `notion-static-parser.config.json`:

```json
{
  "url": "https://almond-brownie-c82.notion.site/Elementary-3b515e0e4a098053bb74c985cebfd777",
  "out": "./_site",
  "keepCname": true,
  "maxPages": 0
}
```

```bash
bunx notion-static-parser init-config
```

## Commands

| Command | Purpose |
|--------|---------|
| `sync` | Crawl public URL → write static files (default) |
| `restore` | Restore `--out` from the previous `.nsp-backup` |
| `trigger` | `workflow_dispatch` on a consumer GitHub repo |
| `help` | Usage |

### Sync flags

- `--url` / `NOTION_URL` — public Notion root
- `--out` / `OUT_DIR` — output directory (default `.`)
- `--keep-cname` — keep existing `CNAME` across sync
- `--max-pages <n>` — safety cap (`0` = unlimited)
- `--delay-ms <n>` — pause between pages (default `1500`)
- `--concurrency <n>` — parallel browser tabs (default `3`)
- `--retries <n>` — retries when Cloudflare blocks (default `3`)
- `--user-data-dir <path>` — Chrome profile (keeps CF cookies)
- `--headed` — show Chromium (helps pass hard challenges)
- `--full` — ignore fingerprints; re-freeze every page

### Resync / cache

Sync builds into a staging folder, then swaps into `--out` and keeps **one**
backup (`--out.nsp-backup`). Unchanged pages (content fingerprint match) skip
freeze/asset download. Use `--full` to force a complete re-scrape. On failure
the live `--out` is left untouched.

```bash
bunx notion-static-parser restore --out ./_site
```

### Trigger

```bash
export GITHUB_TOKEN=ghp_…
bunx notion-static-parser trigger \
  --repo Novailoveyou/elementary.english.orlov.app \
  --workflow sync-notion.yml \
  --ref main
```

## GitHub Actions (Linux container)

Copy [examples/sync-notion.yml](examples/sync-notion.yml) to
`.github/workflows/sync-notion.yml` in your Pages repo.

The workflow:

1. Installs **Google Chrome** on `ubuntu-latest`
2. Points Puppeteer at it via `PUPPETEER_EXECUTABLE_PATH`
3. Caches `~/.notion-static-parser/chrome-profile` for Cloudflare cookies
4. Runs headless with container-safe flags (`--no-sandbox`, `--disable-dev-shm-usage`, …)
5. Uses lower concurrency (`2`) to fit runner memory

Set repository variable `NOTION_URL` to your public site root. No Notion secrets.

Local override for a custom Chrome binary:

```bash
PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome \
  bunx notion-static-parser sync --url "…" --out ./_site
```

## Cloudflare

Notion’s public sites sit behind Cloudflare (“Just a moment…”). The crawler:

1. Uses a **persistent Chrome profile** (`~/.notion-static-parser/chrome-profile`) so `cf_clearance` cookies stick across runs
2. **Waits** for challenges to clear before saving a page
3. **Delays** between page loads (`--delay-ms`)
4. **Retries** blocked pages (`--retries`, default 3)
5. Never saves a challenge interstitial as content

If challenges still stick in headless CI, warm the profile once locally:

```bash
bunx notion-static-parser sync --url "…" --out ./_site --headed --max-pages 5
```

Then re-run headless using the same `--user-data-dir` (or let Actions restore the cached profile).

## How it works

1. Launch Chromium (Puppeteer) — system Chrome, `PUPPETEER_EXECUTABLE_PATH`, or bundled
2. Open each public page and wait for the **live Notion UI** to paint
3. Collect **all** same-origin page links → BFS queue
4. Download CSS / fonts / images into `assets/`
5. **Freeze** the rendered DOM (inline accessible CSS, remove Notion client JS)
6. Rewrite links to local `.html` files + PWA service worker
7. Publish via staging → backup → swap

CLI shows an animated spinner, a progress bar (`done/known`, grows as the queue
discovers pages), and rotating status text for the current phase (navigate,
Cloudflare, views, assets, freeze, …). In GitHub Actions (no TTY) it prints
phase lines every few seconds instead.

## Library

```ts
import { syncNotionSite, triggerWorkflow } from "notion-static-parser";

await syncNotionSite({
  url: "https://….notion.site/…",
  out: "./_site",
  keepCname: true,
});
```

## License

MIT
