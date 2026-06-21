import { useCallback, useEffect, useRef, useState } from "react";
import type { AppState } from "../shared/types.ts";
import { AuthError, api, setToken } from "./api.ts";
import { Console, signalOf, type Signal } from "./components/Console.tsx";
import { Settings } from "./components/Settings.tsx";
import {
  entriesFromDrop,
  entriesFromInput,
  useUploads,
  type UploadTask,
} from "./uploads.ts";

type Tab = "ingest" | "settings";

export function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [tab, setTab] = useState<Tab>("ingest");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsToken, setNeedsToken] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);

  // Wrap every mutating call so the UI shows progress + surfaces errors.
  const run = useCallback(async (fn: () => Promise<AppState>) => {
    setBusy(true);
    setError(null);
    try {
      setState(await fn());
    } catch (e) {
      if (e instanceof AuthError) setNeedsToken(true);
      else setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  // Lightweight refresh used when uploads land (no busy flicker).
  const refresh = useCallback(() => {
    api.getState().then(setState).catch(() => {});
  }, []);
  const uploads = useUploads(refresh);

  useEffect(() => {
    run(api.getState);
  }, [run]);

  const onDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const entries = await entriesFromDrop(e.dataTransfer);
      if (entries.length) uploads.addEntries(entries);
    },
    [uploads],
  );

  const activeDest = state?.config.destinations.find(
    (d) => d.id === state.config.activeDestinationId,
  );

  const groups = state?.groups ?? [];
  const count = (s: Signal) => groups.filter((g) => signalOf(g) === s).length;
  const sendable = groups.filter((g) => signalOf(g) === "locked");
  const files = groups.reduce((n, g) => n + g.partCount, 0);

  if (needsToken) return <TokenGate onSubmit={(t) => { setToken(t); setNeedsToken(false); run(api.getState); }} />;

  return (
    <div
      className="app"
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <aside className="rail">
        <div className="mark">
          <span className="logo">◢◤</span>
          <div>
            <b>Sink</b>
            <span>ingest</span>
          </div>
        </div>

        <nav className="tabs">
          <button className={tab === "ingest" ? "on" : ""} onClick={() => setTab("ingest")}>
            Queue
          </button>
          <button className={tab === "settings" ? "on" : ""} onClick={() => setTab("settings")}>
            Settings
          </button>
        </nav>

        {tab === "ingest" && (
          <div className="gauge">
            <h4>Queue</h4>
            <Meter sig="review" label="Ambiguous" n={count("review")} />
            <Meter sig="fault" label="Fault" n={count("fault")} />
            <Meter sig="locked" label="Confirmed" n={count("locked")} />
            <Meter sig="xfer" label="Transfer" n={count("xfer")} />
            <Meter sig="done" label="Done" n={count("done")} />
            <div className="meter total">
              <span>{groups.length} titles</span>
              <span className="muted">{files} files</span>
            </div>
          </div>
        )}

        <div className="destbox">
          <small>Destination</small>
          {activeDest ? (
            <>
              <b>
                <span className={`led ${activeDest.kind === "ssh" ? "xfer" : "locked"}`} />
                {activeDest.name}
              </b>
              <span className="muted">
                {activeDest.kind}
                {activeDest.ssh ? ` · ${activeDest.ssh.host}` : ""}
              </span>
            </>
          ) : (
            <b className="muted">None configured</b>
          )}
        </div>
      </aside>

      <main className="panel">
        <div className="bar">
          {tab === "ingest" && (
            <>
              <button disabled={busy} onClick={() => run(api.scan)}>
                ⟳ Scan folder
              </button>
              <button disabled={busy} onClick={() => fileInput.current?.click()}>
                + Add files
              </button>
              <button disabled={busy} onClick={() => folderInput.current?.click()}>
                + Add folder
              </button>
              <input
                ref={fileInput}
                type="file"
                multiple
                hidden
                onChange={(e) => e.target.files && uploads.addEntries(entriesFromInput(e.target.files))}
              />
              <input
                ref={folderInput}
                type="file"
                hidden
                {...{ webkitdirectory: "", directory: "" }}
                onChange={(e) => e.target.files && uploads.addEntries(entriesFromInput(e.target.files))}
              />
              <div className="grp">
                <button
                  className="go"
                  disabled={busy || sendable.length === 0}
                  onClick={() =>
                    run(async () => {
                      let s = state!;
                      for (const g of sendable) s = await api.send(g.id);
                      return s;
                    })
                  }
                >
                  ▸ Send all locked ({sendable.length})
                </button>
              </div>
            </>
          )}
          {tab === "settings" && <strong className="bar-title">Settings</strong>}
        </div>

        {error && <div className="banner error">{error}</div>}
        {busy && <div className="progress" />}

        {tab === "ingest" && uploads.tasks.length > 0 && (
          <UploadPanel tasks={uploads.tasks} onCancel={uploads.cancel} onClear={uploads.clearDone} />
        )}

        {state && tab === "ingest" && (
          <div className="content">
            <Console
              state={state}
              disabled={busy}
              onSelect={(id, values) => run(() => api.select(id, values))}
              onCandidate={(id, index) => run(() => api.candidate(id, index))}
              onMatch={(id) => run(() => api.match(id))}
              onConfirm={(id) => run(() => api.confirm(id))}
              onSend={(id) => run(() => api.send(id))}
              onRemove={(id) => run(() => api.remove(id))}
            />
          </div>
        )}

        {state && tab === "settings" && (
          <div className="content">
            <Settings
              state={state}
              onSave={(cfg) => run(() => api.saveConfig(cfg))}
              onTest={api.testDestination}
            />
          </div>
        )}
      </main>

      {dragging && (
        <div className="dropmask">
          <div>Drop files or folders to upload</div>
        </div>
      )}
    </div>
  );
}

function Meter({ sig, label, n }: { sig: Signal; label: string; n: number }) {
  return (
    <div className="meter">
      <span>
        <span className={`led ${sig}`} />
        {label}
      </span>
      <b className={sig}>{n}</b>
    </div>
  );
}

function fmtSize(bytes: number): string {
  const mb = bytes / 1024 / 1024;
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(0)} MB`;
}

function UploadPanel({
  tasks,
  onCancel,
  onClear,
}: {
  tasks: UploadTask[];
  onCancel: (id: string) => void;
  onClear: () => void;
}) {
  const inFlight = tasks.filter((t) => t.status !== "done").length;
  return (
    <div className="uploads">
      <div className="uploads-head">
        <span>
          Uploads <span className="ct">{inFlight} active</span>
        </span>
        <button className="ghost" onClick={onClear}>
          Clear finished
        </button>
      </div>
      {tasks.map((t) => (
        <div key={t.id} className={`up ${t.status}`}>
          <div className="up-name" title={t.relativePath}>
            {t.relativePath}
            {t.error && <span className="err"> · {t.error}</span>}
          </div>
          <div className="up-bar">
            <span style={{ width: `${t.size ? Math.round((t.sent / t.size) * 100) : 0}%` }} />
          </div>
          <div className="up-meta">
            {t.status === "done"
              ? "done"
              : t.status === "error"
                ? "error"
                : `${fmtSize(t.sent)} / ${fmtSize(t.size)}`}
          </div>
          {t.status !== "done" && (
            <button className="up-x" onClick={() => onCancel(t.id)} title="Cancel">
              ✕
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function TokenGate({ onSubmit }: { onSubmit: (token: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <div className="gate">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim()) onSubmit(value.trim());
        }}
      >
        <div className="mark">
          <span className="logo">◢◤</span>
          <b>Sink</b>
        </div>
        <p className="muted">This instance requires an access token.</p>
        <input
          autoFocus
          type="password"
          placeholder="Access token"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <button className="go" type="submit">
          Unlock
        </button>
      </form>
    </div>
  );
}
