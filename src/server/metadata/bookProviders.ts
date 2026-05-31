// Book metadata providers. Audible is primary — it's the catalog Audiobookshelf
// itself uses, and the only key-less source that reliably returns series +
// position + narrator (exactly what the Author/Series/Book layout needs). Open
// Library and Google Books are kept as a fallback for when Audible (an
// unofficial endpoint) is unreachable or returns nothing.

export interface BookHit {
  title: string;
  authors: string[];
  narrators?: string[];
  series?: string;
  seriesIndex?: string;
  year?: string;
  source: string;
}

const TIMEOUT_MS = 8000;

// Audible is region-specific; the marketplace is selected by host.
const AUDIBLE_HOSTS: Record<string, string> = {
  us: "api.audible.com",
  ca: "api.audible.ca",
  uk: "api.audible.co.uk",
  au: "api.audible.com.au",
  fr: "api.audible.fr",
  de: "api.audible.de",
  jp: "api.audible.co.jp",
  it: "api.audible.it",
  in: "api.audible.in",
  es: "api.audible.es",
  br: "api.audible.com.br",
};

async function getJson(url: string): Promise<any | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": "Sink/0.1 (media ingest)" },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function audible(query: string, region: string): Promise<BookHit[]> {
  const host = AUDIBLE_HOSTS[region] ?? AUDIBLE_HOSTS.us;
  const params = new URLSearchParams({
    keywords: query,
    num_results: "10",
    products_sort_by: "Relevance",
    response_groups: "contributors,series,product_attrs,product_desc",
  });
  const data = await getJson(`https://${host}/1.0/catalog/products?${params}`);
  if (!data?.products) return [];
  return data.products
    .map((p: any): BookHit => {
      // A title can belong to several series (e.g. the broad "Cosmere" plus the
      // numbered "Stormlight Archive"). Prefer the one with a sequence number —
      // that's the series the folder layout cares about.
      const seriesList: any[] = p.series ?? [];
      const series = seriesList.find((s) => s.sequence) ?? seriesList[0];
      return {
        title: p.title ?? "",
        authors: (p.authors ?? []).map((a: any) => a.name).filter(Boolean),
        narrators: (p.narrators ?? []).map((n: any) => n.name).filter(Boolean),
        series: series?.title || undefined,
        seriesIndex: series?.sequence || undefined,
        year: p.release_date ? String(p.release_date).slice(0, 4) : undefined,
        source: "audible",
      };
    })
    .filter((h: BookHit) => h.title);
}

async function openLibrary(query: string): Promise<BookHit[]> {
  const url =
    "https://openlibrary.org/search.json?limit=8&fields=title,author_name,first_publish_year&q=" +
    encodeURIComponent(query);
  const data = await getJson(url);
  if (!data?.docs) return [];
  return data.docs.slice(0, 8).map((d: any) => ({
    title: d.title ?? "",
    authors: d.author_name ?? [],
    year: d.first_publish_year ? String(d.first_publish_year) : undefined,
    source: "openlibrary",
  }));
}

async function googleBooks(query: string): Promise<BookHit[]> {
  const url =
    "https://www.googleapis.com/books/v1/volumes?maxResults=8&q=" +
    encodeURIComponent(query);
  const data = await getJson(url);
  if (!data?.items) return [];
  return data.items.slice(0, 8).map((it: any) => {
    const v = it.volumeInfo ?? {};
    return {
      title: v.title ?? "",
      authors: v.authors ?? [],
      year: v.publishedDate ? String(v.publishedDate).slice(0, 4) : undefined,
      source: "googlebooks",
    } as BookHit;
  });
}

/**
 * Look up a book. Tries Audible first; only if it yields nothing do we fall
 * back to the general providers, so Audible's richer results aren't diluted.
 */
export async function lookupBooks(
  query: string,
  region = "us",
): Promise<BookHit[]> {
  const primary = await audible(query, region);
  if (primary.length > 0) return primary;
  const fallback = await Promise.all([openLibrary(query), googleBooks(query)]);
  return fallback.flat().filter((h) => h.title);
}
