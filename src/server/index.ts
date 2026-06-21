import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import multer from "multer";
import { STAGING_DIR, loadConfig, saveConfig } from "./config.ts";
import {
  addDropped,
  chooseCandidate,
  getState,
  matchAll,
  matchItem,
  removeItem,
  scanIngest,
  sendItem,
  updateSelection,
} from "./service.ts";
import { createTransfer } from "./transfer/index.ts";
import type { Destination } from "../shared/types.ts";

const PORT = Number(process.env.PORT ?? 6720);
const root = join(fileURLToPath(import.meta.url), "..", "..", "..");

const upload = multer({
  storage: multer.diskStorage({
    destination: STAGING_DIR,
    filename: (_req, file, cb) =>
      cb(null, `${randomUUID()}__${file.originalname}`),
  }),
});

const app = express();
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
  await matchAll();
  res.json(await getState());
}));

app.post("/api/upload", upload.array("files"), h(async (req, res) => {
  const files = (req.files as Express.Multer.File[]) ?? [];
  for (const f of files) {
    const item = await addDropped(f.path, f.originalname, f.size);
    if (item && item.status === "pending") await matchItem(item.id);
  }
  res.json(await getState());
}));

app.post("/api/items/:id/match", h(async (req, res) => {
  await matchItem(req.params.id);
  res.json(await getState());
}));

app.post("/api/items/:id/select", h(async (req, res) => {
  await updateSelection(req.params.id, req.body.values ?? {});
  res.json(await getState());
}));

app.post("/api/items/:id/candidate", h(async (req, res) => {
  await chooseCandidate(req.params.id, Number(req.body.index));
  res.json(await getState());
}));

app.post("/api/items/:id/send", h(async (req, res) => {
  await sendItem(req.params.id);
  res.json(await getState());
}));

app.delete("/api/items/:id", h(async (req, res) => {
  removeItem(req.params.id);
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
