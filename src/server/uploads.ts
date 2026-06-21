import { mkdir, rename, rm } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, normalize } from "node:path";
import { FileStore } from "@tus/file-store";
import { Server } from "@tus/server";
import { loadConfig } from "./config.ts";
import { registerUpload } from "./service.ts";

/**
 * Sanitise a client-supplied relative path before it touches disk. Strips
 * drive letters / leading slashes, normalises, and rejects any `..` escape so
 * an upload can only ever land *inside* the ingest folder.
 */
export function safeRelPath(raw: string): string {
  const cleaned = (raw || "").replace(/\\/g, "/").replace(/^\/+/, "").trim();
  const norm = normalize(cleaned).replace(/\\/g, "/");
  if (
    !norm ||
    norm === "." ||
    norm === ".." ||
    norm.startsWith("../") ||
    isAbsolute(norm)
  ) {
    throw new Error(`unsafe upload path: ${raw}`);
  }
  return norm;
}

/**
 * tus resumable-upload server. Chunks land in a temp dir *on the ingest
 * filesystem* so the finish step is an atomic rename, not a multi-GB copy.
 * On completion the file is moved into place under ingestFolder, preserving
 * the dropped folder structure, then registered + matched like any ingest.
 */
export async function createUploadServer(): Promise<Server> {
  const cfg = await loadConfig();
  const incoming = join(cfg.ingestFolder, ".tus-incoming");
  await mkdir(incoming, { recursive: true });

  return new Server({
    path: "/api/uploads",
    datastore: new FileStore({ directory: incoming }),
    // Location header is followed through the dev proxy / same origin.
    relativeLocation: true,
    // Generous ceiling; audiobooks are large but not unbounded.
    maxSize: 25 * 1024 * 1024 * 1024,
    async onUploadFinish(_req, upload) {
      const md = upload.metadata ?? {};
      const src = upload.storage?.path;
      if (!src) throw new Error("completed upload has no stored path");
      try {
        const rel = safeRelPath(md.relativePath || md.filename || upload.id);
        const dest = join(cfg.ingestFolder, rel);
        await mkdir(dirname(dest), { recursive: true });
        await rename(src, dest);
        await registerUpload(dest, md.filename || basename(dest), upload.size ?? 0);
      } catch (err) {
        // Reject the upload but don't leave its chunk behind.
        await rm(src, { force: true });
        throw err;
      } finally {
        // The tus sidecar is no longer needed either way.
        await rm(`${src}.json`, { force: true });
      }
      return {};
    },
  });
}
