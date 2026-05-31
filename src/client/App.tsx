import { useCallback, useEffect, useRef, useState } from "react";
import type { AppState } from "../shared/types.ts";
import { api } from "./api.ts";
import { IngestTable } from "./components/IngestTable.tsx";
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
      <header className="topbar">
        <div className="brand">
          <span className="logo">⤵</span>
          <div>
            <h1>Sink</h1>
            <p>media ingest</p>
          </div>
        </div>
        <nav className="tabs">
          <button className={tab === "ingest" ? "on" : ""} onClick={() => setTab("ingest")}>
            Ingest
          </button>
          <button className={tab === "settings" ? "on" : ""} onClick={() => setTab("settings")}>
            Settings
          </button>
        </nav>
        <div className="dest-pill">
          {activeDest ? (
            <>
              <span className={`dot ${activeDest.kind}`} />
              {activeDest.name}
            </>
          ) : (
            <span className="muted">No destination</span>
          )}
        </div>
      </header>

      {error && <div className="banner error">{error}</div>}
      {busy && <div className="progress" />}

      {state && tab === "ingest" && (
        <main className="content">
          <div className="actions">
            <button className="primary" disabled={busy} onClick={() => run(api.scan)}>
              Scan ingest folder
            </button>
            <button disabled={busy} onClick={() => fileInput.current?.click()}>
              Add files…
            </button>
            <input
              ref={fileInput}
              type="file"
              multiple
              hidden
              onChange={(e) => e.target.files && run(() => api.upload(e.target.files!))}
            />
            <span className="hint">…or drag &amp; drop files anywhere</span>
          </div>

          <IngestTable
            state={state}
            disabled={busy}
            onSelect={(id, values) => run(() => api.select(id, values))}
            onCandidate={(id, index) => run(() => api.candidate(id, index))}
            onMatch={(id) => run(() => api.match(id))}
            onSend={(id) => run(() => api.send(id))}
            onRemove={(id) => run(() => api.remove(id))}
          />
        </main>
      )}

      {state && tab === "settings" && (
        <main className="content">
          <Settings
            state={state}
            onSave={(cfg) => run(() => api.saveConfig(cfg))}
            onTest={api.testDestination}
          />
        </main>
      )}

      {dragging && (
        <div className="dropmask">
          <div>Drop files to ingest</div>
        </div>
      )}
    </div>
  );
}
