import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { extname, join } from "node:path";
import type {
  AppState,
  IngestItem,
  MatchResult,
} from "../shared/types.ts";
import { loadConfig } from "./config.ts";
import { extractPart } from "./matching/filename.ts";
import { allMediaTypes, getMatcher, matcherForExtension } from "./media/registry.ts";
import { buildOpf } from "./metadata/opf.ts";
import { buildDestPath } from "./pathTemplate.ts";
import { createTransfer } from "./transfer/index.ts";

// In-memory ingest queue. Items live until sent or dismissed; this is a
// session tool, not a database.
const items = new Map<string, IngestItem>();

export function listItems(): IngestItem[] {
  return [...items.values()].sort((a, b) => a.rawName.localeCompare(b.rawName));
}

export async function getState(): Promise<AppState> {
  return {
    config: await loadConfig(),
    mediaTypes: allMediaTypes(),
    items: listItems(),
  };
}

async function addFile(
  originPath: string,
  rawName: string,
  size: number,
  source: IngestItem["source"],
): Promise<IngestItem | null> {
  const ext = extname(rawName).toLowerCase();
  const matcher = matcherForExtension(ext);
  if (!matcher) return null; // unsupported type — skip silently
  // De-dupe scanned files by path.
  for (const it of items.values()) {
    if (it.originPath === originPath) return it;
  }
  const item: IngestItem = {
    id: randomUUID(),
    source,
    originPath,
    rawName,
    size,
    mediaTypeId: matcher.info.id,
    ext,
    partLabel: extractPart(rawName),
    status: "pending",
  };
  items.set(item.id, item);
  return item;
}

/** Scan the configured ingest folder for new supported files. */
export async function scanIngest(): Promise<IngestItem[]> {
  const cfg = await loadConfig();
  if (!cfg.ingestFolder || !existsSync(cfg.ingestFolder)) return [];
  const entries = await readdir(cfg.ingestFolder, { withFileTypes: true });
  const added: IngestItem[] = [];
  for (const e of entries) {
    if (!e.isFile()) continue;
    const full = join(cfg.ingestFolder, e.name);
    const s = await stat(full);
    const item = await addFile(full, e.name, s.size, "folder");
    if (item) added.push(item);
  }
  return added;
}

/** Register a dropped/uploaded file already staged on disk. */
export async function addDropped(
  stagedPath: string,
  rawName: string,
  size: number,
): Promise<IngestItem | null> {
  return addFile(stagedPath, rawName, size, "drop");
}

async function templateFor(mediaTypeId: string): Promise<string> {
  const cfg = await loadConfig();
  const override = cfg.mediaTypes[mediaTypeId]?.template;
  return override || getMatcher(mediaTypeId)?.info.defaultTemplate || "{title}";
}

async function recomputeDest(item: IngestItem): Promise<void> {
  if (!item.match) return;
  const template = await templateFor(item.mediaTypeId);
  item.destRelPath = buildDestPath(
    template,
    item.match.selected,
    item.rawName,
    item.partLabel,
  ).relPath;
}

/** Run metadata matching for one item and pick the top candidate. */
export async function matchItem(id: string): Promise<IngestItem> {
  const item = items.get(id);
  if (!item) throw new Error("Item not found");
  const matcher = getMatcher(item.mediaTypeId);
  if (!matcher) throw new Error("No matcher for media type");
  const cfg = await loadConfig();

  item.status = "matching";
  try {
    const region = cfg.mediaTypes[item.mediaTypeId]?.region;
    const candidates = await matcher.match(item.rawName, { region });
    const best = candidates[0];
    const match: MatchResult = {
      selected: best ? { ...best.values } : {},
      extra: best?.extra ? { ...best.extra } : undefined,
      confidence: best?.confidence ?? 0,
      candidates,
      lowConfidence: (best?.confidence ?? 0) < cfg.confidenceThreshold,
    };
    item.match = match;
    await recomputeDest(item);
    item.status = "matched";
    item.error = undefined;
  } catch (err) {
    item.status = "error";
    item.error = err instanceof Error ? err.message : String(err);
  }
  return item;
}

export async function matchAll(): Promise<void> {
  await Promise.all(
    listItems()
      .filter((i) => i.status === "pending")
      .map((i) => matchItem(i.id)),
  );
}

/** Apply a user override of field values (re-derives the destination path). */
export async function updateSelection(
  id: string,
  values: Record<string, string>,
): Promise<IngestItem> {
  const item = items.get(id);
  if (!item) throw new Error("Item not found");
  const cfg = await loadConfig();
  if (!item.match) {
    item.match = { selected: {}, confidence: 1, candidates: [], lowConfidence: false };
  }
  item.match.selected = { ...item.match.selected, ...values };
  // A manual edit is treated as user-confident.
  item.match.confidence = 1;
  item.match.lowConfidence = 1 < cfg.confidenceThreshold;
  await recomputeDest(item);
  if (item.status === "pending") item.status = "matched";
  return item;
}

/** Choose one of the candidate matches as the active selection. */
export async function chooseCandidate(
  id: string,
  index: number,
): Promise<IngestItem> {
  const item = items.get(id);
  if (!item?.match) throw new Error("Item not matched");
  const cand = item.match.candidates[index];
  if (!cand) throw new Error("Candidate not found");
  const cfg = await loadConfig();
  item.match.selected = { ...cand.values };
  item.match.extra = cand.extra ? { ...cand.extra } : undefined;
  item.match.confidence = cand.confidence;
  item.match.lowConfidence = cand.confidence < cfg.confidenceThreshold;
  await recomputeDest(item);
  return item;
}

export function removeItem(id: string): void {
  items.delete(id);
}

/** Transfer one item to the active destination. */
export async function sendItem(id: string): Promise<IngestItem> {
  const item = items.get(id);
  if (!item) throw new Error("Item not found");
  const cfg = await loadConfig();
  const dest = cfg.destinations.find((d) => d.id === cfg.activeDestinationId);
  if (!dest) throw new Error("No active destination configured");
  if (!item.destRelPath) throw new Error("Item has no destination path yet");

  item.status = "sending";
  try {
    const transfer = createTransfer(dest);
    await transfer.send(item.originPath, item.destRelPath);
    // Drop a metadata.opf next to the book so Audiobookshelf gets every field.
    if (cfg.writeOpf && item.mediaTypeId === "book" && item.match) {
      const opf = buildOpf(item.match.selected, item.match.extra ?? {});
      const folder = item.destRelPath.split("/").slice(0, -1).join("/");
      await transfer.writeText(
        folder ? `${folder}/metadata.opf` : "metadata.opf",
        opf,
      );
    }
    item.status = "done";
    item.error = undefined;
  } catch (err) {
    item.status = "error";
    item.error = err instanceof Error ? err.message : String(err);
  }
  return item;
}
