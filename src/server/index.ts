import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { loadConfig, saveConfig } from "./config.ts";
import {
  chooseCandidateGroup,
  confirmGroup,
  deleteGroup,
  getState,
  ignoreDup,
  matchAll,
  matchGroup,
  removeGroup,
  scanDupes,
  scanIngest,
  selectGroup,
  sendGroup,
} from "./service.ts";
import { createTransfer } from "./transfer/index.ts";
import { createUploadServer } from "./uploads.ts";
import type { Destination } from "../shared/types.ts";

const PORT = Number(process.env.PORT ?? 6720);
const TOKEN = process.env.SINK_TOKEN;
const root = join(fileURLToPath(import.meta.url), "..", "..", "..");

const app = express();

// Shared-token gate over the whole API (incl. resumable uploads). Open when no
// SINK_TOKEN is set, for local-only use.
app.use("/api", (req, res, next) => {
  if (!TOKEN) return next();
  const hdr = req.header("authorization");
  const tok = hdr?.startsWith("Bearer ") ? hdr.slice(7) : req.header("x-sink-token");
  if (tok === TOKEN) return next();
  res.status(401).json({ error: "unauthorized" });
});

// tus handles raw chunk streams; mount it before the JSON body parser.
const uploads = await createUploadServer();
app.use((req, res, next) => {
  if (req.path === "/api/uploads" || req.path.startsWith("/api/uploads/")) {
    uploads.handle(req, res).catch(next);
    return;
  }
  next();
});

app.use(express.json());

// Small async wrapper so handlers can throw.
const h =
  (fn: (req: express.Request, res: express.Response) => Promise<unknown>) =>
  (req: express.Request, res: express.Response) =>
    fn(req, res).catch((err) =>
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) }),
    );

app.get("/api/state", h(async (_req, res) => res.json(await getState())));

app.post("/api/scan", h(async (_req, res) => {
  await scanIngest();
  // Match in the background so a big folder doesn't hold the request open past
  // proxy timeouts; items show as pending and flip to matched as they resolve.
  matchAll().catch((err) => console.error("background matchAll failed:", err));
  res.json(await getState());
}));

app.post("/api/dupes", h(async (_req, res) => {
  await scanDupes();
  res.json(await getState());
}));

app.post("/api/groups/:id/ignore-dup", h(async (req, res) => {
  ignoreDup(req.params.id);
  res.json(await getState());
}));

app.post("/api/groups/:id/delete", h(async (req, res) => {
  await deleteGroup(req.params.id);
  res.json(await getState());
}));

app.post("/api/groups/:id/match", h(async (req, res) => {
  await matchGroup(req.params.id);
  res.json(await getState());
}));

app.post("/api/groups/:id/select", h(async (req, res) => {
  await selectGroup(req.params.id, req.body.values ?? {});
  res.json(await getState());
}));

app.post("/api/groups/:id/candidate", h(async (req, res) => {
  await chooseCandidateGroup(req.params.id, Number(req.body.index));
  res.json(await getState());
}));

app.post("/api/groups/:id/confirm", h(async (req, res) => {
  await confirmGroup(req.params.id);
  res.json(await getState());
}));

app.post("/api/groups/:id/send", h(async (req, res) => {
  await sendGroup(req.params.id);
  res.json(await getState());
}));

app.delete("/api/groups/:id", h(async (req, res) => {
  removeGroup(req.params.id);
  res.json(await getState());
}));

app.post("/api/config", h(async (req, res) => {
  await saveConfig(req.body);
  res.json(await getState());
}));

app.post("/api/destinations/test", h(async (req, res) => {
  const dest = req.body as Destination;
  try {
    await createTransfer(dest).test();
    res.json({ ok: true });
  } catch (err) {
    res.json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}));

// Serve the built client in production.
if (process.env.NODE_ENV === "production") {
  const clientDir = join(root, "dist", "client");
  if (existsSync(clientDir)) {
    app.use(express.static(clientDir));
    app.get("*", (_req, res) => res.sendFile(join(clientDir, "index.html")));
  }
}

await loadConfig();
app.listen(PORT, () => {
  console.log(`Sink API listening on http://localhost:${PORT}`);
});
