import { useState } from "react";
import type { AppState, MediaTypeInfo, TitleGroup } from "../../shared/types.ts";

interface Props {
  state: AppState;
  disabled: boolean;
  onSelect: (id: string, values: Record<string, string>) => void;
  onCandidate: (id: string, index: number) => void;
  onMatch: (id: string) => void;
  onConfirm: (id: string) => void;
  onSend: (id: string) => void;
  onRemove: (id: string) => void;
}

export type Signal = "fault" | "review" | "xfer" | "locked" | "done";

const SIGNALS: Record<Signal, string> = {
  fault: "Fault",
  review: "Ambiguous",
  xfer: "In transfer",
  locked: "Confirmed",
  done: "Done",
};

/** Reduce a collated title to one status light. Drives colour + grouping. */
export function signalOf(g: TitleGroup): Signal {
  if (g.status === "error") return "fault";
  if (g.status === "done") return "done";
  if (g.status === "sending" || g.status === "matching") return "xfer";
  if (!g.match || g.confidence === 0) return "fault";
  if (g.lowConfidence) return "review";
  return "locked";
}

function fmtSize(bytes: number): string {
  const mb = bytes / 1024 / 1024;
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(0)} MB`;
}

export function Console(props: Props) {
  const groups = props.state.groups;
  const typeById = new Map<string, MediaTypeInfo>(
    props.state.mediaTypes.map((m) => [m.id, m]),
  );
  const [open, setOpen] = useState<string | null>(null);

  if (groups.length === 0) {
    return (
      <div className="empty">
        <p>Queue is clear.</p>
        <p className="muted">Scan the ingest folder or drop files to begin.</p>
      </div>
    );
  }

  let lastSignal: Signal | null = null;
  return (
    <div className="queue">
      {groups.map((g) => {
        const sig = signalOf(g);
        const header = sig !== lastSignal ? sig : null;
        lastSignal = sig;
        const n = groups.filter((x) => signalOf(x) === sig).length;
        return (
          <div key={g.id}>
            {header && (
              <div className={`seg ${sig}`}>
                {SIGNALS[sig]} <span className="ct">{n}</span>
              </div>
            )}
            <Signal
              group={g}
              sig={sig}
              type={typeById.get(g.mediaTypeId)}
              open={open === g.id}
              toggle={() => setOpen(open === g.id ? null : g.id)}
              {...props}
            />
          </div>
        );
      })}
    </div>
  );
}

interface RowProps extends Omit<Props, "state"> {
  group: TitleGroup;
  sig: Signal;
  type?: MediaTypeInfo;
  open: boolean;
  toggle: () => void;
}

function Signal({
  group: g,
  sig,
  type,
  open,
  toggle,
  disabled,
  onSelect,
  onCandidate,
  onMatch,
  onConfirm,
  onSend,
  onRemove,
}: RowProps) {
  const sel = g.match?.selected ?? {};
  const conf = g.confidence > 0 ? `${Math.round(g.confidence * 100)}%` : "--";
  const canSend =
    !disabled && sig !== "done" && sig !== "xfer" && !!g.destFolder;

  return (
    <>
      <div className={`row ${sig} ${open ? "open" : ""}`}>
        <button className="led-btn" onClick={toggle} title="Edit match">
          <span className={`led ${sig}`} />
        </button>
        <div className="title-cell" onClick={toggle}>
          <div className="title">
            {g.title}
            {g.partCount > 1 && <span className="parts">{g.partCount} parts</span>}
          </div>
          <div className="meta">
            {g.subtitle || <span className="muted">no metadata</span>}
            {g.error && <span className="err"> · {g.error}</span>}
          </div>
        </div>
        <div className="path" title={g.destFolder}>
          {g.destFolder ?? <span className="muted">no destination</span>}
        </div>
        <div className={`conf ${sig}`}>{conf}</div>
        <div className="act">
          <button disabled={disabled} onClick={() => onMatch(g.id)} title="Re-match">
            ↻
          </button>
          {sig === "review" && (
            <button
              className="confirm"
              disabled={disabled}
              onClick={() => onConfirm(g.id)}
              title="Lock in this match"
            >
              ✓ Confirm
            </button>
          )}
          {sig === "fault" && (
            <button disabled={disabled} onClick={() => onRemove(g.id)} title="Dismiss">
              ✕
            </button>
          )}
          {(sig === "locked" || sig === "xfer") && (
            <button
              className={sig === "locked" ? "go" : ""}
              disabled={!canSend}
              onClick={() => onSend(g.id)}
            >
              {sig === "xfer" ? "…" : "Send"}
            </button>
          )}
        </div>
      </div>

      {open && type && (
        <div className="drawer">
          <div className="fields">
            {type.fields.map((f) => (
              <label key={f.key}>
                <span>
                  {f.label}
                  {f.required && <em>*</em>}
                </span>
                <input
                  value={sel[f.key] ?? ""}
                  disabled={disabled}
                  onChange={(e) => onSelect(g.id, { [f.key]: e.target.value })}
                />
              </label>
            ))}
          </div>

          {g.match && g.match.candidates.length > 0 && (
            <div className="cands">
              <span className="muted">Candidates</span>
              {g.match.candidates.map((c, i) => (
                <button
                  key={i}
                  className="cand"
                  disabled={disabled}
                  onClick={() => onCandidate(g.id, i)}
                >
                  {c.displayName}
                  <em>{Math.round(c.confidence * 100)}%</em>
                  <small>{c.source}</small>
                </button>
              ))}
            </div>
          )}

          {g.partCount > 1 && (
            <div className="partlist">
              <span className="muted">Joined files</span>
              {g.items.map((it) => (
                <code key={it.id}>
                  {it.rawName} <small>{fmtSize(it.size)}</small>
                </code>
              ))}
            </div>
          )}
          <div className="drawer-act">
            <button disabled={disabled} onClick={() => onRemove(g.id)}>
              Dismiss title
            </button>
          </div>
        </div>
      )}
    </>
  );
}
