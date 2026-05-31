import { basename, extname } from "node:path";

/** Strip characters illegal on common filesystems and tidy whitespace/dots. */
export function sanitizeSegment(s: string): string {
  return s
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[.\s]+|[.\s]+$/g, "")
    .trim();
}

export interface BuiltPath {
  /** Forward-slash relative path under the destination base, incl. filename. */
  relPath: string;
  folder: string;
  fileName: string;
}

/**
 * Resolve a folder template (e.g. "{author}/{series}/{title}") against metadata
 * values. Empty tokens collapse so a missing series doesn't leave a blank dir.
 * The file is placed inside the resolved folder, named after {title} (falling
 * back to the original filename), keeping its original extension.
 */
export function buildDestPath(
  template: string,
  values: Record<string, string>,
  rawName: string,
  partLabel?: string,
): BuiltPath {
  const ext = extname(rawName);

  const segments = template
    .split("/")
    .map((seg) =>
      sanitizeSegment(
        seg.replace(/\{(\w+)\}/g, (_, key) => values[key] ?? ""),
      ),
    )
    .filter(Boolean);

  // When the title came from a match, re-attach the part designation so
  // multi-file books keep distinct, non-colliding filenames. When we fall back
  // to the original filename, the part is already present — leave it alone.
  const title = sanitizeSegment(values.title ?? "");
  const fileBase = title
    ? partLabel
      ? `${title} ${partLabel}`
      : title
    : basename(rawName, ext);
  const fileName = `${sanitizeSegment(fileBase)}${ext}`;

  const folder = segments.join("/");
  const relPath = folder ? `${folder}/${fileName}` : fileName;
  return { relPath, folder, fileName };
}
