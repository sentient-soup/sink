import { useCallback, useRef, useState } from "react";
import * as tus from "tus-js-client";
import { getToken } from "./api.ts";

const CHUNK = 48 * 1024 * 1024; // under proxied 100MB body caps (e.g. Cloudflare)
const CONCURRENCY = 3;

export interface UploadTask {
  id: string;
  name: string;
  relativePath: string;
  size: number;
  sent: number;
  status: "queued" | "uploading" | "done" | "error";
  error?: string;
}

interface Entry {
  file: File;
  relativePath: string;
}

// --- folder traversal -----------------------------------------------------
// Dropped directories aren't in DataTransfer.files; walk them via the entry API.
async function walk(entry: any, prefix: string, out: Entry[]): Promise<void> {
  if (entry.isFile) {
    const file: File = await new Promise((res, rej) => entry.file(res, rej));
    out.push({ file, relativePath: prefix + file.name });
  } else if (entry.isDirectory) {
    const reader = entry.createReader();
    const readBatch = (): Promise<any[]> =>
      new Promise((res, rej) => reader.readEntries(res, rej));
    // readEntries yields in batches; loop until it returns empty.
    for (let batch = await readBatch(); batch.length; batch = await readBatch()) {
      for (const e of batch) await walk(e, `${prefix}${entry.name}/`, out);
    }
  }
}

export async function entriesFromDrop(dt: DataTransfer): Promise<Entry[]> {
  const roots = Array.from(dt.items)
    .filter((i) => i.kind === "file")
    .map((i) => (i as any).webkitGetAsEntry?.())
    .filter(Boolean);
  if (roots.length) {
    const out: Entry[] = [];
    for (const r of roots) await walk(r, "", out);
    return out;
  }
  // Browser without the entry API: flat file list, no folders.
  return Array.from(dt.files).map((file) => ({ file, relativePath: file.name }));
}

export function entriesFromInput(list: FileList): Entry[] {
  return Array.from(list).map((file) => ({
    file,
    // webkitRelativePath is set when a directory was picked.
    relativePath: (file as any).webkitRelativePath || file.name,
  }));
}

// --- upload queue ----------------------------------------------------------
export function useUploads(onFileDone: () => void) {
  const [tasks, setTasks] = useState<UploadTask[]>([]);
  const uploads = useRef(new Map<string, tus.Upload>());
  const queue = useRef<string[]>([]);
  const active = useRef(0);

  const patch = (id: string, p: Partial<UploadTask>) =>
    setTasks((ts) => ts.map((t) => (t.id === id ? { ...t, ...p } : t)));

  const pump = useCallback(() => {
    while (active.current < CONCURRENCY && queue.current.length) {
      const id = queue.current.shift()!;
      const up = uploads.current.get(id);
      if (!up) continue;
      active.current++;
      patch(id, { status: "uploading" });
      // Resume across reloads / disconnects if a fingerprint exists.
      up.findPreviousUploads().then((prev) => {
        if (prev.length) up.resumeFromPreviousUpload(prev[0]);
        up.start();
      });
    }
  }, []);

  const addEntries = useCallback(
    (entries: Entry[]) => {
      const token = getToken();
      const fresh: UploadTask[] = [];
      for (const { file, relativePath } of entries) {
        const id = crypto.randomUUID();
        const up = new tus.Upload(file, {
          endpoint: "/api/uploads",
          chunkSize: CHUNK,
          retryDelays: [0, 1000, 3000, 5000, 10000],
          removeFingerprintOnSuccess: true,
          metadata: { filename: file.name, relativePath },
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          onProgress: (sent, total) => patch(id, { sent, size: total }),
          onSuccess: () => {
            patch(id, { status: "done", sent: file.size });
            active.current--;
            onFileDone();
            pump();
          },
          onError: (err) => {
            patch(id, { status: "error", error: String(err) });
            active.current--;
            pump();
          },
        });
        uploads.current.set(id, up);
        queue.current.push(id);
        fresh.push({
          id,
          name: file.name,
          relativePath,
          size: file.size,
          sent: 0,
          status: "queued",
        });
      }
      setTasks((ts) => [...ts, ...fresh]);
      pump();
    },
    [onFileDone, pump],
  );

  const cancel = useCallback((id: string) => {
    uploads.current.get(id)?.abort(true);
    uploads.current.delete(id);
    queue.current = queue.current.filter((q) => q !== id);
    setTasks((ts) => ts.filter((t) => t.id !== id));
  }, []);

  const clearDone = useCallback(() => {
    setTasks((ts) => ts.filter((t) => t.status !== "done"));
  }, []);

  return { tasks, addEntries, cancel, clearDone };
}
