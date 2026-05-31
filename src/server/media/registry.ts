import type { MediaTypeId, MediaTypeInfo } from "../../shared/types.ts";
import { bookMatcher } from "./book.ts";
import type { Matcher } from "./matcher.ts";

// Register media types here. Each one is fully self-contained.
const matchers: Matcher[] = [bookMatcher];

export function allMediaTypes(): MediaTypeInfo[] {
  return matchers.map((m) => m.info);
}

export function getMatcher(id: MediaTypeId): Matcher | undefined {
  return matchers.find((m) => m.info.id === id);
}

/** Resolve the media type that claims a given file extension (lowercase, dotted). */
export function matcherForExtension(ext: string): Matcher | undefined {
  const e = ext.toLowerCase();
  return matchers.find((m) => m.info.extensions.includes(e));
}

export function supportedExtensions(): string[] {
  return [...new Set(matchers.flatMap((m) => m.info.extensions))];
}
