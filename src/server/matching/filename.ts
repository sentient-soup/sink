export interface ParsedName {
  /** Cleaned, human-ish query string for metadata lookups. */
  query: string;
  /** Best-effort split halves (order is ambiguous, so we keep both). */
  parts: string[];
}

// Noise commonly found in audiobook / media filenames. Order matters: the
// "part N of M" form must run before the plain "part N" form so the trailing
// "of M" isn't left behind to pollute the lookup query.
const PART_WORD = "cd|dis[ck]|part|pt|track|vol(?:ume)?|book|chapter|ch";
const NOISE = [
  /\bunabridged\b/gi,
  /\babridged\b/gi,
  /\baudiobook\b/gi,
  /\bm4b\b/gi,
  /\b\d{2,4}\s?kbps\b/gi,
  // "part 1 of 2", "disc 2/3", "pt. 1 of 3"
  new RegExp(`\\b(?:${PART_WORD})\\.?\\s*\\d+\\s*(?:of|\\/)\\s*\\d+\\b`, "gi"),
  // bare "1 of 2" (digits on both sides, so real titles with "of" are safe)
  /\b\d+\s*of\s*\d+\b/gi,
  // "part 1", "disc 2", "vol 3"
  new RegExp(`\\b(?:${PART_WORD})\\.?\\s*\\d+\\b`, "gi"),
  /\[[^\]]*\]/g, // [tags]
  /\([^)]*\)/g, // (tags / years)
  /\b(19|20)\d{2}\b/g, // bare years
];

/**
 * Strip only a *real* file extension — a short alphanumeric token after the
 * final dot. Avoids node's extname() mangling names like "...pt. 2 of 2",
 * where it would treat " 2 of 2" as the extension.
 */
function stripExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot > 0 && /^[a-z0-9]{1,5}$/i.test(name.slice(dot + 1))) {
    return name.slice(0, dot);
  }
  return name;
}

// "part 1 of 2", "part 1", "disc 3 of 12", and a bare "1 of 2" fallback.
const PART_LABEL_RE = new RegExp(
  `\\b(?:${PART_WORD})\\.?\\s*\\d+(?:\\s*(?:of|\\/)\\s*\\d+)?\\b|\\b\\d+\\s*of\\s*\\d+\\b`,
  "i",
);

/**
 * Extract a multi-part designation (e.g. "part 1 of 2") from a filename so it
 * can be appended back onto the destination filename. Matching strips it to
 * find the title; this preserves it so `Title part 1 of 2.m4b` and
 * `Title part 2 of 2.m4b` land side by side instead of colliding. Original
 * casing is preserved; only separators are tidied.
 */
export function extractPart(rawName: string): string | undefined {
  const cleaned = stripExtension(rawName)
    .replace(/[_.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const m = cleaned.match(PART_LABEL_RE);
  return m ? m[0].replace(/\s+/g, " ").trim() : undefined;
}

/** Parse a raw filename into a clean lookup query and candidate field halves. */
export function parseFilename(rawName: string): ParsedName {
  const original = stripExtension(rawName)
    .replace(/[_.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  let base = original;
  for (const re of NOISE) base = base.replace(re, " ");
  base = base.replace(/\s+/g, " ").trim();
  // Don't let noise-stripping erase the whole name (e.g. a numeric title "1984").
  if (!base) base = original;

  // Split on common author/title separators.
  const parts = base
    .split(/\s+[-–—]\s+|\s*[:|]\s*/)
    .map((p) => p.trim())
    .filter(Boolean);

  // Metadata search engines (Open Library especially) return nothing when the
  // raw " - " separator is left in, so the lookup query uses plain spaces.
  const query = parts.length > 1 ? parts.join(" ") : base;
  return { query, parts: parts.length > 1 ? parts : [base] };
}
