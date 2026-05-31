# Sink

Every media pipeline needs a sink — the terminal node where raw data arrives, gets cleaned up, and handed off in a usable form.

Sink is a lightweight ingest utility for your media server. When your usual automation pipeline can't get the file there for you, Sink fills the gap — drop files in via the web UI, let it sort out the metadata, and move on.

The project is designed from the ground up to be media-agnostic. Audiobooks and ebooks are the starting point, but the architecture is intentionally generic so that Sink can eventually absorb other media types as a unified ingestion layer.

## How it works

1. **Queue files** — Sink watches a configurable *ingest folder* and also accepts files dropped onto (or picked in) the web UI.
2. **Auto-match metadata** — each filename is parsed (part numbers, quality tags, etc. stripped) and looked up against the **Audible catalog** — the same source Audiobookshelf uses — which returns series, series position, and narrator. Open Library + Google Books are automatic fallbacks if Audible is unreachable. Sink ranks candidates and shows a **confidence score**, flagging anything below your threshold so messy one-offs are easy to spot.
3. **Preview the destination** — using an *arr-style folder template (`{author}/{series}/{title}`), Sink shows exactly where each file will land. Empty tokens (e.g. a book with no series) collapse automatically.
4. **Override anything** — expand a row to edit the matched fields or pick a different candidate. Manual edits are treated as fully confident.
5. **Send** — copy the file to the active destination: a **local/mounted path** or a **remote server over SSH/SFTP**. Folders are created as needed.

## Quick start

```bash
npm install
npm run dev      # web UI on http://localhost:5173, API on :8787
```

For a single-process production run (API serves the built UI):

```bash
npm run build
npm start        # http://localhost:8787
```

Then open **Settings** to set your ingest folder, confidence threshold, folder template, Audible region (`us`/`uk`/`de`/…), and at least one destination (mark one *active*). Config and staged uploads live under `data/` (override with `SINK_DATA_DIR`).

## Architecture

Everything is keyed off a **media type**, which declares its own metadata fields, default folder template, and file extensions. Adding a new type (music, video, …) means implementing one `Matcher` and registering it — the scanner, templating, transfer, and UI are all type-driven and need no changes.

```
src/
  shared/types.ts          domain types shared by client & server
  server/
    media/                 registry + per-type matchers (book.ts)
    metadata/              metadata providers (Audible primary; OL/Google fallback)
    matching/              filename parsing + similarity / confidence scoring
    transfer/              Transfer interface + Local and SSH implementations
    pathTemplate.ts        token template → sanitized destination path
    config.ts  service.ts  config persistence + in-memory ingest pipeline
    index.ts               Express API
  client/                  React + Vite web UI
```

> Note: metadata lookups require outbound network access. Without it, Sink degrades gracefully to a filename-derived match that you can edit by hand.
