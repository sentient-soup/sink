// Lightweight string similarity used for match confidence (no deps).

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Dice coefficient over character bigrams: robust to small edits/reorderings. */
function diceBigram(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const bigrams = (s: string) => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2);
      m.set(g, (m.get(g) ?? 0) + 1);
    }
    return m;
  };
  const ba = bigrams(a);
  const bb = bigrams(b);
  let overlap = 0;
  let total = 0;
  for (const n of ba.values()) total += n;
  for (const [g, n] of bb) {
    total += n;
    const inA = ba.get(g) ?? 0;
    if (inA > 0) overlap += Math.min(inA, n);
  }
  return total === 0 ? 0 : (2 * overlap) / total;
}

/** Jaccard over word tokens: rewards shared words regardless of order. */
function tokenJaccard(a: string, b: string): number {
  const ta = new Set(a.split(" ").filter(Boolean));
  const tb = new Set(b.split(" ").filter(Boolean));
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}

/**
 * Combined 0..1 similarity. Blends character-level (typo tolerant) and
 * token-level (order tolerant) measures, which suits messy media filenames.
 */
export function similarity(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return 0;
  return 0.5 * diceBigram(na, nb) + 0.5 * tokenJaccard(na, nb);
}
