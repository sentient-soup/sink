// Generates a metadata.opf sidecar. Audiobookshelf reads OPF automatically on
// scan and maps: title, author, narrator, publishYear, publisher, isbn,
// description, genres, language, series, volumeNumber — so this hands ASB every
// field as a proper distinct value with no file modification and no deps.

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Split a "a|b|c" packed multi-value extra field. */
function multi(v?: string): string[] {
  return (v ?? "").split("|").map((x) => x.trim()).filter(Boolean);
}

/**
 * Build an OPF 2.0 package from the editable core values + extra metadata.
 * Series/sequence use the calibre meta tags Audiobookshelf understands.
 */
export function buildOpf(
  core: Record<string, string>,
  extra: Record<string, string> = {},
): string {
  const lines: string[] = [];
  const meta: string[] = [];

  if (core.title) lines.push(`    <dc:title>${esc(core.title)}</dc:title>`);

  const authors = multi(extra.authors).length
    ? multi(extra.authors)
    : core.author
      ? [core.author]
      : [];
  for (const a of authors)
    lines.push(`    <dc:creator opf:role="aut">${esc(a)}</dc:creator>`);

  const narrators = multi(extra.narrators).length
    ? multi(extra.narrators)
    : core.narrator
      ? [core.narrator]
      : [];
  // ASB reads narrators from dc:creator role="nrt" (it does not read
  // dc:contributor), so emit narrators as creators.
  for (const n of narrators)
    lines.push(`    <dc:creator opf:role="nrt">${esc(n)}</dc:creator>`);

  if (extra.description)
    lines.push(`    <dc:description>${esc(extra.description)}</dc:description>`);
  if (extra.publisher)
    lines.push(`    <dc:publisher>${esc(extra.publisher)}</dc:publisher>`);
  if (core.year) lines.push(`    <dc:date>${esc(core.year)}</dc:date>`);
  if (extra.language)
    lines.push(`    <dc:language>${esc(extra.language)}</dc:language>`);
  if (extra.asin)
    lines.push(
      `    <dc:identifier opf:scheme="ASIN">${esc(extra.asin)}</dc:identifier>`,
    );
  for (const g of multi(extra.genres))
    lines.push(`    <dc:subject>${esc(g)}</dc:subject>`);

  // Series → calibre meta (Audiobookshelf reads these for series/volumeNumber).
  if (core.series)
    meta.push(`    <meta name="calibre:series" content="${esc(core.series)}"/>`);
  if (core.seriesIndex)
    meta.push(
      `    <meta name="calibre:series_index" content="${esc(core.seriesIndex)}"/>`,
    );

  return `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
${lines.join("\n")}
${meta.join("\n")}
  </metadata>
</package>
`;
}
