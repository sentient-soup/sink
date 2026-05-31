import type { MatchResult } from "../../shared/types.ts";

/** Confidence pill; turns amber/red and shows a flag when below threshold. */
export function Confidence({ match }: { match?: MatchResult }) {
  if (!match) return <span className="conf none">—</span>;
  const pct = Math.round(match.confidence * 100);
  const level = match.lowConfidence ? "low" : pct >= 85 ? "high" : "mid";
  return (
    <span className={`conf ${level}`} title={match.lowConfidence ? "Below threshold" : "Match confidence"}>
      {match.lowConfidence && <span className="flag">⚠</span>}
      {pct}%
    </span>
  );
}
