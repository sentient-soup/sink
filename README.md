# Sink

Every media pipeline needs a sink — the terminal node where raw data arrives, gets cleaned up, and handed off in a usable form.

Sink is a lightweight ingest utility for your media server. When your usual automation pipeline can't get the file there for you, Sink fills the gap — drop files in via the web UI, let it sort out the metadata, and move on.

The project is designed from the ground up to be media-agnostic. Audiobooks and ebooks are the starting point, but the architecture is intentionally generic so that Sink can eventually absorb other media types as a unified ingestion layer.

## How it works

1. **Queue files** — Sink watches a configurable *ingest folder* and also accepts files and **whole folders** dropped onto (or picked in) the web UI. Uploads are **resumable** (tus): a dropped connection picks up where it left off, and large files are chunked so they pass through reverse proxies that cap request bodies. Folder structure is preserved into the ingest folder.
2. **Auto-match metadata** — each filename is parsed (part numbers, quality tags, etc. stripped) and looked up against the **Audible catalog** — the same source Audiobookshelf uses — which returns series, series position, and narrator. Open Library + Google Books are automatic fallbacks if Audible is unreachable. Sink ranks candidates and shows a **confidence score**, flagging anything below your threshold so messy one-offs are easy to spot.
3. **Preview the destination** — using an *arr-style folder template (`{author}/{series}/{title}`), Sink shows exactly where each file will land. Empty tokens (e.g. a book with no series) collapse automatically.
4. **Override anything** — expand a row to edit the matched fields or pick a different candidate. Manual edits are treated as fully confident.
5. **Send** — copy the file to the active destination: a **local/mounted path** or a **remote server over SSH/SFTP**. Folders are created as needed. Most audiobooks already carry embedded tags that Audiobookshelf reads directly; for files that arrive bare, an optional **`metadata.opf`** sidecar (off by default, toggle in Settings) writes author, series, series sequence, narrator(s), description, genres, publisher, language, year, and ASIN as proper fields ASB reads on scan.

## Quick start

```bash
pnpm install
pnpm dev         # web UI on http://localhost:5173, API on :6720
```

For a single-process production run (API serves the built UI):

```bash
pnpm build
pnpm start       # http://localhost:6720
```

Then open **Settings** to set your ingest folder, confidence threshold, folder template, Audible region (`us`/`uk`/`de`/…), and at least one destination (mark one *active*). Config lives under `data/` (override with `SINK_DATA_DIR`).

## Remote access &amp; uploads

Sink is built to be driven from anywhere, not just the machine it runs on. Drag-and-drop **uploads file contents** (not paths), so a user on another network can drop a folder of audiobooks and it streams into the container's ingest folder; the normal match → confirm → send flow then copies it into your media library.

- **Auth** — set `SINK_TOKEN` to gate the entire API (including uploads) behind a shared token. The UI prompts for it once and remembers it. Without the token set, Sink is open (intended for local-only use). Pair the token with HTTPS — a [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) is the easiest way to get TLS and avoid exposing the origin directly.
- **Large files** — uploads are chunked (48&nbsp;MB) and resumable, so they survive flaky links and slip under proxy body-size caps (e.g. Cloudflare's 100&nbsp;MB). If you front Sink with nginx, set `proxy_request_buffering off;` on the `/api/uploads` location.
- **Docker** — bind-mount your host ingest and media folders (see [`docker-compose.yml`](docker-compose.yml)) and add a *local* destination pointing at the media mount (`/media`). Keep the resumable-upload staging on the same volume as the ingest folder (the default `.tus-incoming` does) so finished uploads move by rename, not copy.

## Architecture

Everything is keyed off a **media type**, which declares its own metadata fields, default folder template, and file extensions. Adding a new type (music, video, …) means implementing one `Matcher` and registering it — the scanner, templating, transfer, and UI are all type-driven and need no changes.

```
src/
  shared/types.ts          domain types shared by client & server
  server/
    media/                 registry + per-type matchers (book.ts)
    metadata/              providers (Audible primary; OL/Google fallback) + OPF sidecar
    matching/              filename parsing + similarity / confidence scoring
    transfer/              Transfer interface + Local and SSH implementations
    pathTemplate.ts        token template → sanitized destination path
    config.ts  service.ts  config persistence + in-memory ingest pipeline
    index.ts               Express API
  client/                  React + Vite web UI
```

> Note: metadata lookups require outbound network access. Without it, Sink degrades gracefully to a filename-derived match that you can edit by hand.
