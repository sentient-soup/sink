import { useCallback, useEffect, useRef, useState } from "react";
import type { AppState } from "../shared/types.ts";
import { api } from "./api.ts";
import { Console, signalOf, type Signal } from "./components/Console.tsx";
import { Settings } from "./components/Settings.tsx";

type Tab = "ingest" | "settings";

export function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [tab, setTab] = useState<Tab>("ingest");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  // Wrap every mutating call so the UI shows progress + surfaces errors.
  const run = useCallback(async (fn: () => Promise<AppState>) => {
    setBusy(true);
    setError(null);
    try {
      setState(await fn());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    run(api.getState);
  }, [run]);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      if (e.dataTransfer.files.length) run(() => api.upload(e.dataTransfer.files));
    },
    [run],
  );

  const activeDest = state?.config.destinations.find(
    (d) => d.id === state.config.activeDestinationId,
  );

  const groups = state?.groups ?? [];
  const count = (s: Signal) => groups.filter((g) => signalOf(g) === s).length;
  const sendable = groups.filter((g) => signalOf(g) === "locked");
  const files = groups.reduce((n, g) => n + g.partCount, 0);

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
              <input
                ref={fileInput}
                type="file"
                multiple
                hidden
                onChange={(e) => e.target.files && run(() => api.upload(e.target.files!))}
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
          <div>Drop files to ingest</div>
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
