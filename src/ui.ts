const RESET = "\x1b[0m";
const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
/** Light blue for live status */
const CYAN = "\x1b[96m";
const BOLD = "\x1b[1m";

export const c = {
  dim: (s: string) => `${DIM}${s}${RESET}`,
  green: (s: string) => `${GREEN}${s}${RESET}`,
  yellow: (s: string) => `${YELLOW}${s}${RESET}`,
  red: (s: string) => `${RED}${s}${RESET}`,
  cyan: (s: string) => `${CYAN}${s}${RESET}`,
  bold: (s: string) => `${BOLD}${s}${RESET}`,
};

/** stderr — keeps console.log on stdout from breaking in-place updates */
const out = process.stderr;
const isCi = Boolean(process.env.CI || process.env.GITHUB_ACTIONS);
const canSpin = Boolean(out.isTTY) && !isCi;

const STATUS_LINES = 3;

export function header(title: string): void {
  pauseStatus();
  console.log(c.bold(`\nnotion-static-parser · ${title}`));
}

export function info(msg: string): void {
  pauseStatus();
  console.log(c.cyan("ℹ"), msg);
  resumeStatus();
}

export function success(msg: string): void {
  pauseStatus();
  console.log(c.green("✔"), msg);
}

export function warn(msg: string): void {
  pauseStatus();
  console.log(c.yellow("⚠"), msg);
  resumeStatus();
}

export function fail(msg: string): void {
  pauseStatus();
  console.error(c.red("✖"), msg);
}

export function note(msg: string): void {
  if (spinWanted) {
    spinFlavor = msg;
    paintStatus();
    return;
  }
  pauseStatus();
  console.log(c.dim(`  ${msg}`));
}

export function blank(): void {
  pauseStatus();
  console.log();
}

export function kv(key: string, value: string): void {
  console.log(`  ${c.dim(key.padEnd(12))} ${value}`);
}

/* ── progress + spinner ──────────────────────────────────── */

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;

const PHASE_FLAVOR: Record<string, string[]> = {
  prepare: ["Setting up staging…", "Copying previous site…", "Warming asset map…"],
  navigate: ["Opening Notion page…", "Waiting for first paint…", "Following redirects…"],
  challenge: [
    "Cloudflare clearance check…",
    "Waiting for bot challenge…",
    "Reusing cf_clearance…",
  ],
  content: ["Waiting for Notion UI…", "Looking for page blocks…", "Content settling…"],
  fingerprint: ["Fingerprinting page…", "Comparing with cache…", "Checking for changes…"],
  views: ["Capturing collection views…", "Clicking tabs…", "Snapshotting layouts…"],
  assets: ["Downloading images & fonts…", "Saving CSS…", "Fetching media…"],
  links: ["Collecting links…", "Growing crawl queue…", "Discovering pages…"],
  freeze: ["Freezing DOM…", "Inlining styles…", "Stripping client JS…"],
  write: ["Writing HTML…", "Rewriting links…", "Injecting runtime…"],
  rewrite: ["Final rewrite pass…", "Patching collection JSON…", "Normalizing assets…"],
  pwa: ["Building SW precache…", "Writing manifest…", "Listing offline assets…"],
  publish: ["Backing up previous site…", "Atomic swap…", "Almost done…"],
  idle: ["Crawling…", "Workers busy…", "Queue moving…"],
};

type ProgressState = {
  done: number;
  queued: number;
  active: number;
  skipped: number;
  known: number;
};

let spinLabel = "";
let spinPhase = "idle";
let spinFlavor = "";
let spinWanted = false;
let frameIdx = 0;
let frameTimer: ReturnType<typeof setInterval> | null = null;
let flavorTimer: ReturnType<typeof setInterval> | null = null;
let progress: ProgressState = {
  done: 0,
  queued: 0,
  active: 0,
  skipped: 0,
  known: 0,
};
let statusDirty = false;
let lastCiDone = -1;
let lastCiAt = 0;
let lastPaintAt = 0;
let lastPaintKey = "";

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

function termCols(): number {
  const n = out.columns || process.stdout.columns || 80;
  return Math.max(48, Math.min(n, 120));
}

function truncate(label: string, max: number): string {
  if (max <= 0) return "";
  if (label.length <= max) return label;
  if (max === 1) return "…";
  return `${label.slice(0, Math.max(0, max - 1))}…`;
}

function fit(text: string): string {
  return truncate(text, termCols() - 1);
}

function progressBar(done: number, total: number, width = 18): string {
  const t = Math.max(total, done, 1);
  const ratio = Math.min(1, done / t);
  const filled = Math.round(ratio * width);
  const empty = Math.max(0, width - filled);
  const pct = Math.round(ratio * 100);
  return `${"█".repeat(filled)}${"░".repeat(empty)} ${String(pct).padStart(3)}%`;
}

function estimateTotal(): number {
  return Math.max(
    progress.known,
    progress.done + progress.queued + progress.active,
    1,
  );
}

function pickFlavor(phase: string): string {
  const list = PHASE_FLAVOR[phase] || PHASE_FLAVOR.idle!;
  return list[Math.floor(Math.random() * list.length)]!;
}

/**
 * Exactly three lines:
 *   1) spinner + bar + counts
 *   2) file path
 *   3) hint text
 */
function composeRows(frame: string): [string, string, string] {
  const total = estimateTotal();
  const bar = progressBar(progress.done, total);
  const counts = `${progress.done}/${total}`;
  const extra = progress.skipped > 0 ? ` · ${progress.skipped} cached` : "";
  const active = progress.active > 0 ? ` · ${progress.active} active` : "";

  return [
    fit(`${frame} ${bar} ${counts}${extra}${active}`),
    fit(spinLabel || "…"),
    fit(spinFlavor || pickFlavor(spinPhase)),
  ];
}

/** Clear `count` lines upward from the current cursor (log-update style). */
function eraseLines(count: number): string {
  if (count <= 0) return "";
  let s = "";
  for (let i = 0; i < count; i++) {
    s += "\x1b[2K";
    if (i < count - 1) s += "\x1b[1A";
  }
  return `${s}\r`;
}

function pauseStatus(): void {
  if (!statusDirty) return;
  if (out.isTTY) out.write(eraseLines(STATUS_LINES));
  statusDirty = false;
  lastPaintKey = "";
}

function resumeStatus(): void {
  if (spinWanted) paintStatus(true);
}

function writeStatus(rows: [string, string, string]): void {
  if (statusDirty) out.write(eraseLines(STATUS_LINES));
  // No trailing newline after the last row — cursor stays on line 3
  out.write(
    `${CYAN}${rows[0]}${RESET}\n` +
      `${CYAN}${rows[1]}${RESET}\n` +
      `${CYAN}${rows[2]}${RESET}`,
  );
  statusDirty = true;
}

function paintStatus(force = false): void {
  if (!spinWanted) return;

  const now = Date.now();
  if (!force && canSpin && now - lastPaintAt < 120) return;

  const frame = canSpin ? FRAMES[frameIdx % FRAMES.length]! : "…";
  const rows = composeRows(frame);
  const key = rows.join("\n");

  if (out.isTTY && !isCi) {
    if (!force && key === lastPaintKey) return;
    writeStatus(rows);
    lastPaintAt = now;
    lastPaintKey = key;
    return;
  }

  if (progress.done !== lastCiDone || now - lastCiAt > 30_000) {
    lastCiDone = progress.done;
    lastCiAt = now;
    lastPaintAt = now;
    console.error(rows.join("\n"));
  }
}

function ensureTimers(): void {
  if (!canSpin) return;
  if (!frameTimer) {
    frameTimer = setInterval(() => {
      if (!spinWanted) return;
      frameIdx = (frameIdx + 1) % FRAMES.length;
      lastPaintKey = "";
      paintStatus(true);
    }, 140);
    frameTimer.unref?.();
  }
  if (!flavorTimer) {
    flavorTimer = setInterval(() => {
      if (!spinWanted) return;
      spinFlavor = pickFlavor(spinPhase);
      paintStatus(true);
    }, 2500);
    flavorTimer.unref?.();
  }
}

function clearTimers(): void {
  if (frameTimer) {
    clearInterval(frameTimer);
    frameTimer = null;
  }
  if (flavorTimer) {
    clearInterval(flavorTimer);
    flavorTimer = null;
  }
}

export function setProgress(partial: Partial<ProgressState>): void {
  progress = {
    ...progress,
    ...partial,
    known: Math.max(
      progress.known,
      partial.known ?? 0,
      (partial.done ?? progress.done) +
        (partial.queued ?? progress.queued) +
        (partial.active ?? progress.active),
    ),
  };
  if (spinWanted) paintStatus();
}

export function setPhase(phase: string, label?: string): void {
  const phaseChanged = phase && phase !== spinPhase;
  spinPhase = phase || "idle";
  if (label) spinLabel = label;
  if (phaseChanged) spinFlavor = pickFlavor(spinPhase);
  if (spinWanted) paintStatus();
}

export function startSpinner(label: string, phase = "idle"): void {
  spinLabel = label;
  spinPhase = phase;
  spinFlavor = pickFlavor(phase);
  spinWanted = true;
  ensureTimers();
  paintStatus(true);
}

export function updateSpinner(label: string, phase?: string): void {
  spinLabel = label;
  if (phase && phase !== spinPhase) {
    spinPhase = phase;
    spinFlavor = pickFlavor(phase);
  } else if (phase) {
    spinPhase = phase;
  }
  spinWanted = true;
  ensureTimers();
  paintStatus();
}

export function stopSpinner(): void {
  pauseStatus();
  spinWanted = false;
  clearTimers();
}
