import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { readdir, stat, unlink } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import type {
  AppState,
  IngestItem,
  ItemStatus,
  MatchResult,
  TitleGroup,
} from "../shared/types.ts";
import { loadConfig } from "./config.ts";
import { findDuplicate } from "./matching/dupes.ts";
import { extractPart, parseFilename } from "./matching/filename.ts";
import { allMediaTypes, getMatcher, matcherForExtension } from "./media/registry.ts";
import { buildOpf } from "./metadata/opf.ts";
import { buildDestPath } from "./pathTemplate.ts";
import { createTransfer } from "./transfer/index.ts";

// In-memory ingest queue. Items live until sent or dismissed; this is a
// session tool, not a database.
const items = new Map<string, IngestItem>();

// Duplicate warnings from the most recent dupe scan: group id -> existing
// library folder it likely duplicates. `dupIgnored` mutes a warning the user
// has reviewed and waved through. Both reset only with the process.
const dupWarnings = new Map<string, string>();
const dupIgnored = new Set<string>();

export function listItems(): IngestItem[] {
  return [...items.values()].sort((a, b) => a.rawName.localeCompare(b.rawName));
}

// A file in its own subfolder is one title with the rest of that folder
// (folder-per-book audiobooks split into per-chapter files, or an upload that
// kept its folder). Files sitting flat in the ingest root collate instead by
// their cleaned filename query, since parseFilename strips the "part N of M"
// designation so "Dune pt 1/2" still fold together.
// ponytail: a query collision between two different flat titles would
// over-merge; acceptable for a session tool, revisit with a per-match key.
function groupKey(it: IngestItem): string {
  if (it.groupDir) return `dir:${it.groupDir}`;
  return `${it.mediaTypeId} ${parseFilename(it.rawName).query.toLowerCase()}`;
}

function membersOf(id: string): IngestItem[] {
  const anchor = items.get(id);
  if (!anchor) return [];
  const key = groupKey(anchor);
  return listItems().filter((it) => groupKey(it) === key);
}

// Most-active / worst status wins, so the queue surfaces what still needs work.
const STATUS_RANK: ItemStatus[] = [
  "error",
  "sending",
  "matching",
  "pending",
  "matched",
  "done",
];
function aggregateStatus(members: IngestItem[]): ItemStatus {
  for (const s of STATUS_RANK) if (members.some((m) => m.status === s)) return s;
  return "matched";
}

function buildGroup(members: IngestItem[]): TitleGroup {
  const sorted = [...members].sort((a, b) => a.rawName.localeCompare(b.rawName));
  const rep = sorted.find((m) => m.match) ?? sorted[0];
  const sel = rep.match?.selected ?? {};
  const title =
    sel.title || parseFilename(rep.rawName).query || rep.rawName;
  const subtitle = [
    sel.author,
    sel.series && `${sel.series}${sel.seriesIndex ? ` #${sel.seriesIndex}` : ""}`,
    sel.narrator && `read by ${sel.narrator}`,
  ]
    .filter(Boolean)
    .join(" · ");
  // Worst confidence drives the decision; an unmatched part counts as zero.
  const confidence = Math.min(
    ...sorted.map((m) => (m.match ? m.match.confidence : 0)),
  );
  const destFolder = rep.destRelPath
    ? rep.destRelPath.split("/").slice(0, -1).join("/")
    : undefined;
  return {
    id: rep.id,
    mediaTypeId: rep.mediaTypeId,
    title,
    subtitle,
    status: aggregateStatus(sorted),
    confidence,
    lowConfidence: sorted.some((m) => m.match?.lowConfidence),
    destFolder,
    dupPath: dupIgnored.has(rep.id) ? undefined : dupWarnings.get(rep.id),
    partCount: sorted.length,
    items: sorted,
    match: rep.match,
    error: sorted.find((m) => m.error)?.error,
  };
}

export function listGroups(): TitleGroup[] {
  const byKey = new Map<string, IngestItem[]>();
  for (const it of listItems()) {
    const k = groupKey(it);
    const arr = byKey.get(k);
    if (arr) arr.push(it);
    else byKey.set(k, [it]);
  }
  const groups = [...byKey.values()].map(buildGroup);
  // Surface the work: faults and low-confidence first, finished last.
  const rank = (g: TitleGroup) =>
    g.status === "error" || g.confidence === 0
      ? 0
      : g.lowConfidence
        ? 1
        : g.status === "pending" || g.status === "matching"
          ? 2
          : g.status === "done"
            ? 5
            : g.status === "sending"
              ? 4
              : 3;
  return groups.sort(
    (a, b) => rank(a) - rank(b) || a.confidence - b.confidence,
  );
}

// Read once at startup; the build's package.json is the source of truth and a
// pre-commit hook bumps it every commit, so this reveals which image is live.
const VERSION: string = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
).version;

export async function getState(): Promise<AppState> {
  return {
    config: await loadConfig(),
    mediaTypes: allMediaTypes(),
    groups: listGroups(),
    version: VERSION,
  };
}

async function addFile(
  originPath: string,
  rawName: string,
  size: number,
  source: IngestItem["source"],
  ingestRoot: string,
): Promise<IngestItem | null> {
  const ext = extname(rawName).toLowerCase();
  const matcher = matcherForExtension(ext);
  if (!matcher) return null; // unsupported type — skip silently
  // De-dupe scanned files by path.
  for (const it of items.values()) {
    if (it.originPath === originPath) return it;
  }
  // A file directly in the ingest root has no owning folder; one nested in a
  // subfolder belongs to that folder's title.
  const parent = dirname(originPath);
  const groupDir = resolve(parent) === resolve(ingestRoot) ? undefined : parent;
  const item: IngestItem = {
    id: randomUUID(),
    source,
    originPath,
    rawName,
    size,
    mediaTypeId: matcher.info.id,
    ext,
    partLabel: extractPart(rawName),
    groupDir,
    status: "pending",
  };
  items.set(item.id, item);
  return item;
}

/**
 * Recursively scan the ingest folder for new supported files. Uploaded books
 * arrive inside their own folders, and audiobook libraries are folder-per-book,
 * so a flat top-level scan would miss everything. Skips the tus staging dir and
 * any dotfolders. ponytail: doesn't follow symlinks; add if a library needs it.
 */
export async function scanIngest(): Promise<IngestItem[]> {
  const cfg = await loadConfig();
  if (!cfg.ingestFolder || !existsSync(cfg.ingestFolder)) return [];
  const added: IngestItem[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === ".tus-incoming" || e.name.startsWith(".")) continue;
        await walk(full);
      } else if (e.isFile()) {
        const s = await stat(full);
        const item = await addFile(full, e.name, s.size, "folder", cfg.ingestFolder);
        if (item) added.push(item);
      }
    }
  };
  await walk(cfg.ingestFolder);
  return added;
}

/**
 * Register a file that a resumable upload just placed in the ingest folder,
 * then kick off matching. Mirrors a scanned file but flagged as a drop.
 */
export async function registerUpload(
  fullPath: string,
  rawName: string,
  size: number,
): Promise<void> {
  const cfg = await loadConfig();
  const item = await addFile(fullPath, rawName, size, "drop", cfg.ingestFolder);
  if (item && item.status === "pending") await matchItem(item.id);
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
    // A folder-per-book part keeps its original (chapter) filename; only the
    // owning folder is rewritten from the book's metadata.
    Boolean(item.groupDir),
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
    // For a folder-per-book title, the folder name carries the book title; the
    // individual filenames are just chapters. Match on the folder name.
    const matchName = item.groupDir ? basename(item.groupDir) : item.rawName;
    const candidates = await matcher.match(matchName, { region });
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

// Cap on simultaneous metadata lookups. A scan of a big ingest folder used to
// fire one matchItem per file at once (hundreds of concurrent provider calls),
// which exhausted the process. ponytail: fixed pool, raise if throughput lags.
const MATCH_CONCURRENCY = 5;

/**
 * Match one representative of a title, then copy its metadata onto every other
 * part. Parts of a title share all metadata and differ only in filename, so a
 * single provider lookup serves the whole group — a 200-chapter folder costs
 * one call, not 200. Each part still derives its own destination path.
 */
async function matchAndFanOut(members: IngestItem[]): Promise<void> {
  if (members.length === 0) return;
  const rep = members[0];
  await matchItem(rep.id);
  for (const m of members) {
    if (m.id === rep.id) continue;
    m.match = rep.match
      ? {
          ...rep.match,
          selected: { ...rep.match.selected },
          extra: rep.match.extra ? { ...rep.match.extra } : undefined,
        }
      : undefined;
    m.status = rep.status;
    m.error = rep.error;
    await recomputeDest(m);
  }
}

/** Group pending items by title and match each title once (see matchAndFanOut). */
export async function matchAll(): Promise<void> {
  const byKey = new Map<string, IngestItem[]>();
  for (const it of listItems().filter((i) => i.status === "pending")) {
    const arr = byKey.get(groupKey(it));
    if (arr) arr.push(it);
    else byKey.set(groupKey(it), [it]);
  }
  const groups = [...byKey.values()];
  let next = 0;
  const worker = async () => {
    while (next < groups.length) await matchAndFanOut(groups[next++]);
  };
  await Promise.all(
    Array.from({ length: Math.min(MATCH_CONCURRENCY, groups.length) }, worker),
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

// --- Group actions: a user decides on a title once; we fan out to its parts.

export async function matchGroup(id: string): Promise<void> {
  await matchAndFanOut(membersOf(id));
}

export async function selectGroup(
  id: string,
  values: Record<string, string>,
): Promise<void> {
  for (const m of membersOf(id)) await updateSelection(m.id, values);
}

/** Apply the representative's chosen candidate to every part of the title. */
export async function chooseCandidateGroup(
  id: string,
  index: number,
): Promise<void> {
  const members = membersOf(id);
  const cand = members.find((m) => m.match)?.match?.candidates[index];
  if (!cand) throw new Error("Candidate not found");
  const cfg = await loadConfig();
  for (const m of members) {
    if (!m.match) m.match = { selected: {}, confidence: 0, candidates: [], lowConfidence: false };
    m.match.selected = { ...cand.values };
    m.match.extra = cand.extra ? { ...cand.extra } : undefined;
    m.match.confidence = cand.confidence;
    m.match.lowConfidence = cand.confidence < cfg.confidenceThreshold;
    await recomputeDest(m);
  }
}

/** Lock in an ambiguous title: user vouches for the current pick. */
export async function confirmGroup(id: string): Promise<void> {
  for (const m of membersOf(id)) {
    if (!m.match) continue;
    m.match.confidence = 1;
    m.match.lowConfidence = false;
  }
}

export async function sendGroup(id: string): Promise<void> {
  for (const m of membersOf(id)) {
    if (m.status !== "done") await sendItem(m.id);
  }
}

export function removeGroup(id: string): void {
  for (const m of membersOf(id)) items.delete(m.id);
}

// --- Duplicate detection against the destination library.

/** Collect folder paths under `base`, depth-bounded (author/series/title is 3
 *  deep; we don't descend into the book's content files). */
async function collectDirs(base: string, maxDepth = 3): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string, rel: string, depth: number) => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return; // unreadable folder — skip rather than fail the whole scan
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      out.push(childRel);
      if (depth < maxDepth) await walk(join(dir, e.name), childRel, depth + 1);
    }
  };
  await walk(base, "", 1);
  return out;
}

/**
 * Scan the active (local) destination for titles the queue may already hold,
 * flagging each match for the user to review. Advisory only: nothing is moved
 * or deleted. ponytail: local destinations only — SSH would need a remote
 * listing; add it if a remote library ever needs the same guard.
 */
export async function scanDupes(): Promise<void> {
  dupWarnings.clear();
  const cfg = await loadConfig();
  const dest = cfg.destinations.find((d) => d.id === cfg.activeDestinationId);
  if (!dest || dest.kind !== "local") return;
  const dirs = await collectDirs(dest.basePath);
  if (dirs.length === 0) return;
  for (const g of listGroups()) {
    const needle = g.destFolder || g.title;
    if (!needle) continue;
    const hit = findDuplicate(needle, dirs, g.destFolder);
    if (hit) dupWarnings.set(g.id, hit);
  }
}

/** Mute a reviewed duplicate warning so the title flows through normally. */
export function ignoreDup(id: string): void {
  dupIgnored.add(id);
  dupWarnings.delete(id);
}

/** Delete a duplicate's ingest files from disk and drop it from the queue. */
export async function deleteGroup(id: string): Promise<void> {
  for (const m of membersOf(id)) {
    try {
      await unlink(m.originPath);
    } catch {
      // Already gone or unwritable — still drop it from the queue.
    }
    items.delete(m.id);
  }
  dupWarnings.delete(id);
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
