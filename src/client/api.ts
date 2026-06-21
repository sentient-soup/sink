import type { AppConfig, AppState, Destination } from "../shared/types.ts";

const TOKEN_KEY = "sink_token";
let token = typeof localStorage !== "undefined" ? localStorage.getItem(TOKEN_KEY) ?? "" : "";

export function getToken(): string {
  return token;
}
export function setToken(t: string): void {
  token = t;
  localStorage.setItem(TOKEN_KEY, t);
}

/** Thrown on a 401 so the UI can prompt for the shared token. */
export class AuthError extends Error {}

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return token ? { ...extra, Authorization: `Bearer ${token}` } : extra;
}

async function json<T>(res: Response): Promise<T> {
  if (res.status === 401) throw new AuthError("unauthorized");
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as any).error ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

const post = (url: string, body?: unknown) =>
  fetch(url, {
    method: "POST",
    headers: headers({ "Content-Type": "application/json" }),
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then(json<AppState>);

export const api = {
  getState: () => fetch("/api/state", { headers: headers() }).then(json<AppState>),
  scan: () => post("/api/scan"),
  match: (id: string) => post(`/api/groups/${id}/match`),
  select: (id: string, values: Record<string, string>) =>
    post(`/api/groups/${id}/select`, { values }),
  candidate: (id: string, index: number) =>
    post(`/api/groups/${id}/candidate`, { index }),
  confirm: (id: string) => post(`/api/groups/${id}/confirm`),
  send: (id: string) => post(`/api/groups/${id}/send`),
  remove: (id: string) =>
    fetch(`/api/groups/${id}`, { method: "DELETE", headers: headers() }).then(json<AppState>),
  saveConfig: (cfg: Partial<AppConfig>) => post("/api/config", cfg),
  testDestination: (dest: Destination) =>
    fetch("/api/destinations/test", {
      method: "POST",
      headers: headers({ "Content-Type": "application/json" }),
      body: JSON.stringify(dest),
    }).then(json<{ ok: boolean; error?: string }>),
};
