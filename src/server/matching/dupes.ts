import { similarity } from "./similarity.ts";

const leaf = (p: string) => p.split("/").pop() ?? p;

/**
 * Decide whether a title already lives in the destination library.
 * `needle` is the group's destination folder (author/series/title) or, failing
 * that, its title; `dirs` are existing folder paths under the books root.
 *
 * An exact hit on the computed `destFolder` is a definite duplicate. Otherwise
 * the closest folder by name above `threshold` is flagged as "similar enough"
 * for the user to eyeball, never auto-acted on.
 *
 * ponytail: O(groups × folders) string compare on a manual, one-off check;
 * build an index if a giant library ever makes it drag.
 */
export function findDuplicate(
  needle: string,
  dirs: string[],
  destFolder?: string,
  threshold = 0.72,
): string | undefined {
  if (destFolder && dirs.includes(destFolder)) return destFolder;
  let best = 0;
  let match: string | undefined;
  for (const d of dirs) {
    const score = Math.max(
      similarity(needle, d),
      similarity(leaf(needle), leaf(d)),
    );
    if (score > best) {
      best = score;
      match = d;
    }
  }
  return best >= threshold ? match : undefined;
}
