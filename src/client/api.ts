import type { AppConfig, AppState, Destination } from "../shared/types.ts";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as any).error ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

const post = (url: string, body?: unknown) =>
  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then(json<AppState>);

export const api = {
  getState: () => fetch("/api/state").then(json<AppState>),
  scan: () => post("/api/scan"),
  match: (id: string) => post(`/api/items/${id}/match`),
  select: (id: string, values: Record<string, string>) =>
    post(`/api/items/${id}/select`, { values }),
  candidate: (id: string, index: number) =>
    post(`/api/items/${id}/candidate`, { index }),
  send: (id: string) => post(`/api/items/${id}/send`),
  remove: (id: string) =>
    fetch(`/api/items/${id}`, { method: "DELETE" }).then(json<AppState>),
  saveConfig: (cfg: Partial<AppConfig>) => post("/api/config", cfg),
  upload: (files: FileList | File[]) => {
    const fd = new FormData();
    for (const f of Array.from(files)) fd.append("files", f);
    return fetch("/api/upload", { method: "POST", body: fd }).then(json<AppState>);
  },
  testDestination: (dest: Destination) =>
    fetch("/api/destinations/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(dest),
    }).then(json<{ ok: boolean; error?: string }>),
};
