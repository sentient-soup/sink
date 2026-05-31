import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AppConfig } from "../shared/types.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const DATA_DIR = process.env.SINK_DATA_DIR ?? join(root, "data");
export const STAGING_DIR = join(DATA_DIR, "staging");
const CONFIG_PATH = join(DATA_DIR, "config.json");

const DEFAULT_CONFIG: AppConfig = {
  ingestFolder: join(DATA_DIR, "ingest"),
  confidenceThreshold: 0.6,
  activeDestinationId: undefined,
  destinations: [],
  mediaTypes: {
    book: { template: "{author}/{series}/{title}", region: "us" },
  },
};

let cache: AppConfig | null = null;

async function ensureDirs(): Promise<void> {
  for (const d of [DATA_DIR, STAGING_DIR]) {
    if (!existsSync(d)) await mkdir(d, { recursive: true });
  }
}

export async function loadConfig(): Promise<AppConfig> {
  if (cache) return cache;
  await ensureDirs();
  if (existsSync(CONFIG_PATH)) {
    try {
      const raw = JSON.parse(await readFile(CONFIG_PATH, "utf8"));
      cache = { ...DEFAULT_CONFIG, ...raw };
      return cache!;
    } catch {
      // Corrupt config — fall back to defaults rather than crash.
    }
  }
  cache = structuredClone(DEFAULT_CONFIG);
  await writeFile(CONFIG_PATH, JSON.stringify(cache, null, 2));
  return cache;
}

export async function saveConfig(next: Partial<AppConfig>): Promise<AppConfig> {
  const current = await loadConfig();
  cache = { ...current, ...next };
  await writeFile(CONFIG_PATH, JSON.stringify(cache, null, 2));
  return cache;
}
