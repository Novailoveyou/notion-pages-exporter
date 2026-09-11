# Changelog

## 1.0.2

- Fix CI: when syncing with `--out .` (GitHub Actions), preserve `.git` / `.github`
  instead of renaming the checkout into `*.nsp-backup` (which broke Commit & push)

## 1.0.0

- Initial release: Puppeteer BFS scrape of public `notion.site` pages
- Freezes live Notion UI (not admin HTML-export styling)
- Cloudflare handling: wait for clearance, persistent Chrome profile, delays,
  retries, SPA clicks for subpages
- Downloads CSS/fonts/images; strips client JS for offline static hosting
- CLI: `sync`, `trigger`, `init-config`, `help`
- Sample GitHub Actions workflow (cron every 4h + workflow_dispatch)
