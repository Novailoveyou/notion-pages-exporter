import readline from "node:readline";

const RESET = "\x1b[0m";
const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const CYAN = "\x1b[96m"; // progress
const GRAY = "\x1b[90m"; // path
const WHITE = "\x1b[97m"; // hint
const BOLD = "\x1b[1m";

export const c = {
  dim: (s: string) => `${DIM}${s}${RESET}`,
  green: (s: string) => `${GREEN}${s}${RESET}`,
  yellow: (s: string) => `${YELLOW}${s}${RESET}`,
  red: (s: string) => `${RED}${s}${RESET}`,
  cyan: (s: string) => `${CYAN}${s}${RESET}`,
  bold: (s: string) => `${BOLD}${s}${RESET}`,
};

/** Prefer stdout — same stream as console.log so cursor math stays consistent */
const out = process.stdout;
const isCi = Boolean(process.env.CI || process.env.GITHUB_ACTIONS);
const canSpin = Boolean(out.isTTY) && !isCi;

/**
 * Prefer a true 3-line status block.
 * Set NSP_STATUS_SINGLE=1 only if your terminal can't do cursor-up cleanly.
 */
const forceSingle = process.env.NSP_STATUS_SINGLE === "1";
const ideTerminal = forceSingle;

const STATUS_LINES = 3;

export function header(title: string): void {
  pauseStatus();
  console.log(c.bold(`\nnotion-static-exporter · ${title}`));
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
    paintStatus(true);
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
let painting = false;

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

function termCols(): number {
  const n = out.columns || process.stdout.columns || 80;
  return Math.max(40, Math.min(n, 100));
}

function truncate(label: string, max: number): string {
  if (max <= 0) return "";
  if (label.length <= max) return label;
  if (max === 1) return "…";
  return `${label.slice(0, Math.max(0, max - 1))}…`;
}

function fitExact(text: string, width: number): string {
  const t = truncate(text, width);
  return t + " ".repeat(Math.max(0, width - t.length));
}

function progressBar(done: number, total: number, width = 16): string {
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

function composePlain(frame: string): {
  progress: string;
  path: string;
  hint: string;
} {
  const total = estimateTotal();
  const bar = progressBar(progress.done, total);
  const counts = `${progress.done}/${total}`;
  const bits: string[] = [];
  if (progress.skipped > 0) bits.push(`${progress.skipped} cached`);
  if (progress.active > 0) bits.push(`${progress.active} active`);
  const meta = bits.length ? `  ·  ${bits.join("  ·  ")}` : "";

  return {
    progress: `${frame}  ${bar}  ${counts}${meta}`,
    path: spinLabel || "…",
    hint: spinFlavor || pickFlavor(spinPhase),
  };
}

function eraseLines(count: number): void {
  if (count <= 0 || !out.isTTY) return;
  try {
    for (let i = 0; i < count; i++) {
      readline.clearLine(out, 0);
      readline.cursorTo(out, 0);
      if (i < count - 1) readline.moveCursor(out, 0, -1);
    }
  } catch {
    let seq = "";
    for (let i = 0; i < count; i++) {
      seq += "\x1b[2K";
      if (i < count - 1) seq += "\x1b[1A";
    }
    out.write(`${seq}\r`);
  }
}

function pauseStatus(): void {
  if (!statusDirty) return;
  if (out.isTTY) {
    if (ideTerminal) out.write("\r\x1b[2K");
    else eraseLines(STATUS_LINES);
  }
  statusDirty = false;
  lastPaintKey = "";
}

function resumeStatus(): void {
  if (spinWanted) paintStatus(true);
}

/** 3-line block for real terminals — never wraps (exact width). */
function writeMulti(parts: { progress: string; path: string; hint: string }): void {
  const w = termCols() - 1;
  const r1 = fitExact(parts.progress, w);
  const r2 = fitExact(`  ${parts.path}`, w);
  const r3 = fitExact(`  ${parts.hint}`, w);
  if (statusDirty) eraseLines(STATUS_LINES);
  out.write(
    `${CYAN}${r1}${RESET}\n` + `${GRAY}${r2}${RESET}\n` + `${WHITE}${r3}${RESET}`,
  );
  statusDirty = true;
}

/**
 * IDE-safe: one \\r line, same info + colors (cyan / gray / white).
 * This is the only in-place mode that never spams in Cursor.
 */
function writeSingle(parts: { progress: string; path: string; hint: string }): void {
  const w = termCols() - 1;
  // Budget widths: progress gets priority, then path, then hint
  const progress = truncate(parts.progress, Math.min(42, Math.floor(w * 0.45)));
  const rest = w - stripAnsi(progress).length - 6;
  const pathW = Math.max(8, Math.floor(rest * 0.55));
  const hintW = Math.max(8, rest - pathW);
  const path = truncate(parts.path, pathW);
  const hint = truncate(parts.hint, hintW);
  const line =
    `${CYAN}${progress}${RESET}` +
    `  ${GRAY}${path}${RESET}` +
    `  ${WHITE}${hint}${RESET}`;
  out.write(`\r\x1b[2K${line}`);
  statusDirty = true;
}

function paintStatus(force = false): void {
  if (!spinWanted || painting) return;
  painting = true;
  try {
    const now = Date.now();
    if (!force && canSpin && now - lastPaintAt < 120) return;

    const frame = canSpin ? FRAMES[frameIdx % FRAMES.length]! : "·";
    const parts = composePlain(frame);
    const key = `${parts.progress}\n${parts.path}\n${parts.hint}`;

    if (out.isTTY && !isCi) {
      if (!force && key === lastPaintKey) return;
      if (ideTerminal) writeSingle(parts);
      else writeMulti(parts);
      lastPaintAt = now;
      lastPaintKey = key;
      return;
    }

    if (progress.done !== lastCiDone || now - lastCiAt > 30_000) {
      lastCiDone = progress.done;
      lastCiAt = now;
      lastPaintAt = now;
      console.error(`${parts.progress}\n${parts.path}\n${parts.hint}`);
    }
  } finally {
    painting = false;
  }
}

function ensureTimers(): void {
  if (!canSpin) return;
  // Slow spinner — frequent redraws are what look like spam when erase glitches
  if (!frameTimer) {
    frameTimer = setInterval(() => {
      if (!spinWanted) return;
      frameIdx = (frameIdx + 1) % FRAMES.length;
      lastPaintKey = "";
      paintStatus(true);
    }, ideTerminal ? 450 : 280);
    frameTimer.unref?.();
  }
  if (!flavorTimer) {
    flavorTimer = setInterval(() => {
      if (!spinWanted) return;
      spinFlavor = pickFlavor(spinPhase);
      paintStatus(true);
    }, 3000);
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
  if (spinWanted) paintStatus(true);
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
