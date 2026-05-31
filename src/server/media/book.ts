import type { MatchCandidate, MediaTypeInfo } from "../../shared/types.ts";
import { parseFilename } from "../matching/filename.ts";
import { similarity } from "../matching/similarity.ts";
import { lookupBooks } from "../metadata/bookProviders.ts";
import type { Matcher, MatchContext } from "./matcher.ts";

export const bookInfo: MediaTypeInfo = {
  id: "book",
  label: "Audiobook / Book",
  extensions: [".m4b", ".m4a", ".mp3", ".aax", ".epub", ".pdf"],
  fields: [
    { key: "author", label: "Author", required: true },
    { key: "series", label: "Series" },
    { key: "seriesIndex", label: "Series #" },
    { key: "title", label: "Title", required: true },
    { key: "narrator", label: "Narrator" },
    { key: "year", label: "Year" },
  ],
  defaultTemplate: "{author}/{series}/{title}",
  templateTokens: [
    "author",
    "series",
    "seriesIndex",
    "title",
    "narrator",
    "year",
  ],
};

function uniqueKey(c: MatchCandidate): string {
  return `${c.values.author}|${c.values.title}`.toLowerCase();
}

export const bookMatcher: Matcher = {
  info: bookInfo,

  async match(rawName: string, ctx?: MatchContext): Promise<MatchCandidate[]> {
    const parsed = parseFilename(rawName);
    const hits = await lookupBooks(parsed.query, ctx?.region);

    const candidates: MatchCandidate[] = hits.map((h) => {
      const author = h.authors[0] ?? "";
      // Score the candidate's "title author" against the cleaned filename so we
      // are tolerant of author/title ordering in the original name.
      const compare = `${h.title} ${h.authors.join(" ")}`;
      let confidence = similarity(compare, parsed.query);
      // Small boost when one filename half closely matches the author.
      if (author && parsed.parts.length > 1) {
        const best = Math.max(...parsed.parts.map((p) => similarity(p, author)));
        confidence = Math.min(1, confidence + 0.15 * best);
      }
      const series = h.series ?? "";
      const label = series
        ? `${author} — ${series}${h.seriesIndex ? ` #${h.seriesIndex}` : ""}: ${h.title}`
        : author
          ? `${author} — ${h.title}`
          : h.title;
      return {
        values: {
          author,
          series,
          seriesIndex: h.seriesIndex ?? "",
          title: h.title,
          narrator: h.narrators?.[0] ?? "",
          year: h.year ?? "",
        },
        displayName: label,
        confidence: Number(confidence.toFixed(3)),
        source: h.source,
      };
    });

    // Always offer a filename-derived fallback so matching works offline and
    // gives the user an editable starting point.
    const [a, b] = parsed.parts;
    candidates.push({
      values: {
        author: parsed.parts.length > 1 ? a : "",
        series: "",
        seriesIndex: "",
        title: parsed.parts.length > 1 ? b : parsed.query,
        narrator: "",
        year: "",
      },
      displayName: `From filename: ${parsed.query}`,
      confidence: 0.2,
      source: "filename",
    });

    // Dedupe (keep highest confidence) and sort.
    const byKey = new Map<string, MatchCandidate>();
    for (const c of candidates) {
      const k = uniqueKey(c);
      const existing = byKey.get(k);
      if (!existing || c.confidence > existing.confidence) byKey.set(k, c);
    }
    return [...byKey.values()].sort((x, y) => y.confidence - x.confidence);
  },
};
