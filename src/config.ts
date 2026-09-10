import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type ParserConfig = {
  url?: string;
  out?: string;
  keepCname?: boolean;
  maxPages?: number;
  delayMs?: number;
  maxRetries?: number;
  concurrency?: number;
  userDataDir?: string;
  workflow?: string;
  repo?: string;
  ref?: string;
};

const CONFIG_NAMES = [
  "notion-static-parser.config.json",
  ".notion-static-parser.json",
];

export function loadConfig(projectRoot: string): ParserConfig {
  for (const name of CONFIG_NAMES) {
    const path = join(projectRoot, name);
    if (!existsSync(path)) continue;
    try {
      const raw = JSON.parse(readFileSync(path, "utf8")) as ParserConfig;
      return raw && typeof raw === "object" ? raw : {};
    } catch {
      throw new Error(`Invalid JSON config: ${path}`);
    }
  }
  return {};
}

export const exampleConfigJson = `{
  "url": "https://almond-brownie-c82.notion.site/Elementary-3b515e0e4a098053bb74c985cebfd777",
  "out": ".",
  "keepCname": true,
  "maxPages": 0,
  "delayMs": 1500,
  "concurrency": 3,
  "maxRetries": 3
}
`;
