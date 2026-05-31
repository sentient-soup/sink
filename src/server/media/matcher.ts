import type { MatchCandidate, MediaTypeInfo } from "../../shared/types.ts";

/** Per-lookup context derived from config (e.g. provider region). */
export interface MatchContext {
  region?: string;
}

/**
 * A Matcher owns one media type: it advertises its metadata schema + folder
 * template (info) and turns a raw filename into ranked metadata candidates.
 * Add a new media type by implementing this and registering it — nothing else
 * in the pipeline needs to change (open for extension).
 */
export interface Matcher {
  info: MediaTypeInfo;
  match(rawName: string, ctx?: MatchContext): Promise<MatchCandidate[]>;
}
