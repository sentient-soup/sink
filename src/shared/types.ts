// Shared domain types used by both the API server and the web client.
// The design is deliberately media-agnostic: a "media type" describes its own
// metadata fields and folder template, so adding ebooks, music, etc. later is
// just registering a new MediaTypeInfo + matcher (open for extension).

export type MediaTypeId = string;

/** One metadata field a media type tracks (e.g. author, series, title). */
export interface MatchField {
  key: string;
  label: string;
  /** Used by the matcher / template; missing required fields lower confidence. */
  required?: boolean;
}

/** Static description of a media type. Mirrored to the client for rendering. */
export interface MediaTypeInfo {
  id: MediaTypeId;
  label: string;
  /** Lowercase extensions including the dot, e.g. [".m4b", ".mp3"]. */
  extensions: string[];
  fields: MatchField[];
  /** Default folder layout, tokens wrapped in braces e.g. "{author}/{series}/{title}". */
  defaultTemplate: string;
  /** Tokens available to templates (field keys plus a few synthetics). */
  templateTokens: string[];
}

/** A single metadata guess for a file, with a 0..1 confidence. */
export interface MatchCandidate {
  /** field key -> value (editable core fields shown in the UI) */
  values: Record<string, string>;
  /** Extra metadata not shown as editable fields but written to sidecars
   *  (e.g. description, genres, publisher, asin, all authors/narrators). */
  extra?: Record<string, string>;
  displayName: string;
  confidence: number;
  source: string;
}

export interface MatchResult {
  /** Current field values (may be user-overridden). */
  selected: Record<string, string>;
  /** Extra metadata from the chosen candidate (carried to sidecars). */
  extra?: Record<string, string>;
  confidence: number;
  candidates: MatchCandidate[];
  /** True when confidence is under the configured threshold. */
  lowConfidence: boolean;
}

export type IngestSource = "folder" | "drop";

export type ItemStatus =
  | "pending"
  | "matching"
  | "matched"
  | "sending"
  | "done"
  | "error";

export interface IngestItem {
  id: string;
  source: IngestSource;
  /** Absolute path on the server (scanned file) or staged upload path (drop). */
  originPath: string;
  rawName: string;
  size: number;
  mediaTypeId: MediaTypeId;
  ext: string;
  /** Multi-part designation parsed from the filename (e.g. "part 1 of 2"),
   *  stripped for matching but preserved in the destination filename. */
  partLabel?: string;
  match?: MatchResult;
  /** Relative destination path under the destination base, derived from template. */
  destRelPath?: string;
  status: ItemStatus;
  error?: string;
}

export interface SshConfig {
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKeyPath?: string;
}

export interface Destination {
  id: string;
  name: string;
  kind: "local" | "ssh";
  /** Base directory on the target where the template path is appended. */
  basePath: string;
  ssh?: SshConfig;
}

export interface MediaTypeConfig {
  /** Template override; falls back to the media type's defaultTemplate. */
  template?: string;
  /** Metadata provider region/marketplace (e.g. Audible "us", "uk", "de"). */
  region?: string;
}

export interface AppConfig {
  ingestFolder: string;
  /** 0..1; matches below this are flagged as low confidence. */
  confidenceThreshold: number;
  /** Write a metadata.opf sidecar next to transferred books (Audiobookshelf). */
  writeOpf: boolean;
  activeDestinationId?: string;
  destinations: Destination[];
  mediaTypes: Record<MediaTypeId, MediaTypeConfig>;
}

/**
 * One title collated from its part files. Multi-part audiobooks arrive as
 * several files (`Dune pt1`, `Dune pt2`); they share a cleaned filename query,
 * so the server folds them into a single entry the user decides on once. A
 * single-file title is just a group of one.
 */
export interface TitleGroup {
  /** Representative member's id — used as the group handle in the API. */
  id: string;
  mediaTypeId: MediaTypeId;
  /** Display title (from the chosen match, else the cleaned filename). */
  title: string;
  /** Secondary line, e.g. "Author · Series #1 · Narrator". */
  subtitle: string;
  /** Aggregate status (worst/most-active member wins). */
  status: ItemStatus;
  /** Worst confidence across parts — that's the one that needs a human. */
  confidence: number;
  lowConfidence: boolean;
  /** Shared destination folder (filename stripped). */
  destFolder?: string;
  /** Existing library folder this title likely duplicates (set by a dupe scan,
   *  cleared when ignored). Advisory only; the user decides. */
  dupPath?: string;
  partCount: number;
  /** Member files, sorted by part. */
  items: IngestItem[];
  /** Representative match: shared metadata + candidate list shown on expand. */
  match?: MatchResult;
  error?: string;
}

/** Payload returned by GET /api/state — everything the UI needs to render. */
export interface AppState {
  config: AppConfig;
  mediaTypes: MediaTypeInfo[];
  /** Ingest queue collated into one entry per title. */
  groups: TitleGroup[];
  /** package.json version of the running build — surfaced so an auto-updated
   *  image is recognizable in the UI. */
  version: string;
}
