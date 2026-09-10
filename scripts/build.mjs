#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");

function run(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: "inherit", cwd: root, shell: false });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

if (existsSync(dist)) {
  try {
    rmSync(dist, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  } catch {
    run("rm", ["-rf", dist]);
  }
}

const bun = process.platform === "win32" ? "bun.exe" : "bun";

run(bun, [
  "build",
  "./src/cli.ts",
  "--outfile=dist/cli.js",
  "--target=node",
  "--format=esm",
  "--packages=external",
]);

run(bun, [
  "build",
  "./src/index.ts",
  "--outfile=dist/index.js",
  "--target=node",
  "--format=esm",
  "--packages=external",
]);

run(bun, [
  "build",
  "./src/index.ts",
  "--outfile=dist/index.cjs",
  "--target=node",
  "--format=cjs",
  "--packages=external",
]);

run(process.execPath, [
  join(root, "node_modules/typescript/bin/tsc"),
  "-p",
  "tsconfig.dts.json",
]);

const cliPath = join(dist, "cli.js");
const shebang = "#!/usr/bin/env node\n";
const { readFileSync, chmodSync } = await import("node:fs");
let cli = readFileSync(cliPath, "utf8");
if (!cli.startsWith("#!")) {
  writeFileSync(cliPath, shebang + cli);
}
chmodSync(cliPath, 0o755);
