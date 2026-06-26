import { useState } from "react";
import type {
  AppConfig,
  AppState,
  Destination,
} from "../../shared/types.ts";

interface Props {
  state: AppState;
  onSave: (cfg: Partial<AppConfig>) => void;
  onTest: (d: Destination) => Promise<{ ok: boolean; error?: string }>;
  onResetQueue: () => void;
}

const newId = () => Math.random().toString(36).slice(2, 9);

export function Settings({ state, onSave, onTest, onResetQueue }: Props) {
  const [cfg, setCfg] = useState<AppConfig>(structuredClone(state.config));
  const [testResult, setTestResult] = useState<Record<string, string>>({});

  const patch = (p: Partial<AppConfig>) => setCfg((c) => ({ ...c, ...p }));

  const patchDest = (id: string, p: Partial<Destination>) =>
    patch({
      destinations: cfg.destinations.map((d) =>
        d.id === id ? { ...d, ...p } : d,
      ),
    });

  const patchSsh = (id: string, p: Partial<NonNullable<Destination["ssh"]>>) =>
    patch({
      destinations: cfg.destinations.map((d) =>
        d.id === id
          ? { ...d, ssh: { host: "", port: 22, username: "", ...d.ssh, ...p } }
          : d,
      ),
    });

  const addDest = (kind: Destination["kind"]) =>
    patch({
      destinations: [
        ...cfg.destinations,
        {
          id: newId(),
          name: kind === "ssh" ? "New SSH target" : "New local target",
          kind,
          basePath: "",
          ssh: kind === "ssh" ? { host: "", port: 22, username: "" } : undefined,
        },
      ],
    });

  const test = async (d: Destination) => {
    setTestResult((r) => ({ ...r, [d.id]: "testing…" }));
    const res = await onTest(d);
    setTestResult((r) => ({
      ...r,
      [d.id]: res.ok ? "✓ reachable" : `✕ ${res.error ?? "failed"}`,
    }));
  };

  return (
    <div className="settings">
      <section className="card">
        <h2>Ingest</h2>
        <label className="field">
          <span>Ingest folder</span>
          <input
            value={cfg.ingestFolder}
            onChange={(e) => patch({ ingestFolder: e.target.value })}
            placeholder="C:\\incoming\\audiobooks"
          />
        </label>
        <label className="field">
          <span>Confidence threshold ({Math.round(cfg.confidenceThreshold * 100)}%)</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={cfg.confidenceThreshold}
            onChange={(e) => patch({ confidenceThreshold: Number(e.target.value) })}
          />
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={cfg.writeOpf}
            onChange={(e) => patch({ writeOpf: e.target.checked })}
          />
          <span>
            Write <code>metadata.opf</code> sidecar
            <small className="muted"> — fallback for files that arrive without embedded tags; ASB reads it on scan</small>
          </span>
        </label>
        <div className="field">
          <span>
            Queue
            <small className="muted"> — clear the in-memory queue to restart the ingest process (files on disk are kept)</small>
          </span>
          <button
            className="ghost"
            onClick={() => {
              if (confirm("Clear the queue? Files on disk are kept; re-scan to repopulate."))
                onResetQueue();
            }}
          >
            Reset queue
          </button>
        </div>
      </section>

      <section className="card">
        <h2>Folder templates</h2>
        <p className="muted">
          Tokens collapse when empty. Available per media type below.
        </p>
        {state.mediaTypes.map((mt) => {
          const mtc = cfg.mediaTypes[mt.id] ?? {};
          const setMt = (p: Partial<typeof mtc>) =>
            patch({
              mediaTypes: { ...cfg.mediaTypes, [mt.id]: { ...mtc, ...p } },
            });
          return (
            <div key={mt.id} className="mtblock">
              <label className="field">
                <span>
                  {mt.label}
                  <small className="tokens">
                    {mt.templateTokens.map((t) => `{${t}}`).join("  ")}
                  </small>
                </span>
                <input
                  value={mtc.template ?? mt.defaultTemplate}
                  onChange={(e) => setMt({ template: e.target.value })}
                />
              </label>
              {mt.id === "book" && (
                <label className="field">
                  <span>Audible region</span>
                  <select
                    value={mtc.region ?? "us"}
                    onChange={(e) => setMt({ region: e.target.value })}
                  >
                    {["us", "uk", "ca", "au", "de", "fr", "it", "es", "in", "jp", "br"].map(
                      (r) => (
                        <option key={r} value={r}>
                          {r.toUpperCase()}
                        </option>
                      ),
                    )}
                  </select>
                </label>
              )}
            </div>
          );
        })}
      </section>

      <section className="card">
        <div className="cardhead">
          <h2>Destinations</h2>
          <div>
            <button onClick={() => addDest("local")}>+ Local</button>
            <button onClick={() => addDest("ssh")}>+ SSH</button>
          </div>
        </div>

        {cfg.destinations.length === 0 && (
          <p className="muted">No destinations yet. Add a local path or SSH target.</p>
        )}

        {cfg.destinations.map((d) => (
          <div className="dest" key={d.id}>
            <div className="destrow">
              <label className="radio">
                <input
                  type="radio"
                  name="active"
                  checked={cfg.activeDestinationId === d.id}
                  onChange={() => patch({ activeDestinationId: d.id })}
                />
                active
              </label>
              <input
                className="grow"
                value={d.name}
                onChange={(e) => patchDest(d.id, { name: e.target.value })}
              />
              <span className={`badge ${d.kind}`}>{d.kind}</span>
              <button onClick={() => test(d)}>Test</button>
              <button
                className="ghost"
                onClick={() =>
                  patch({
                    destinations: cfg.destinations.filter((x) => x.id !== d.id),
                  })
                }
              >
                ✕
              </button>
            </div>

            <input
              className="field"
              value={d.basePath}
              placeholder={
                d.kind === "ssh" ? "/mnt/media/audiobooks" : "Z:\\audiobooks"
              }
              onChange={(e) => patchDest(d.id, { basePath: e.target.value })}
            />

            {d.kind === "ssh" && (
              <div className="sshgrid">
                <input
                  placeholder="host"
                  value={d.ssh?.host ?? ""}
                  onChange={(e) => patchSsh(d.id, { host: e.target.value })}
                />
                <input
                  placeholder="port"
                  type="number"
                  value={d.ssh?.port ?? 22}
                  onChange={(e) => patchSsh(d.id, { port: Number(e.target.value) })}
                />
                <input
                  placeholder="username"
                  value={d.ssh?.username ?? ""}
                  onChange={(e) => patchSsh(d.id, { username: e.target.value })}
                />
                <input
                  placeholder="password (or use key)"
                  type="password"
                  value={d.ssh?.password ?? ""}
                  onChange={(e) => patchSsh(d.id, { password: e.target.value })}
                />
                <input
                  className="grow"
                  placeholder="private key path (optional)"
                  value={d.ssh?.privateKeyPath ?? ""}
                  onChange={(e) => patchSsh(d.id, { privateKeyPath: e.target.value })}
                />
              </div>
            )}
            {testResult[d.id] && <div className="testres">{testResult[d.id]}</div>}
          </div>
        ))}
      </section>

      <div className="savebar">
        <button className="primary" onClick={() => onSave(cfg)}>
          Save settings
        </button>
      </div>
    </div>
  );
}
