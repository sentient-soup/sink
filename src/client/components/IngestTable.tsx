import { useState } from "react";
import type { AppState, IngestItem, MediaTypeInfo } from "../../shared/types.ts";
import { Confidence } from "./Confidence.tsx";

interface Props {
  state: AppState;
  disabled: boolean;
  onSelect: (id: string, values: Record<string, string>) => void;
  onCandidate: (id: string, index: number) => void;
  onMatch: (id: string) => void;
  onSend: (id: string) => void;
  onRemove: (id: string) => void;
}

function fmtSize(bytes: number): string {
  const mb = bytes / 1024 / 1024;
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(0)} MB`;
}

export function IngestTable(props: Props) {
  const { state } = props;
  const items = state.items;
  const typeById = new Map<string, MediaTypeInfo>(
    state.mediaTypes.map((m) => [m.id, m]),
  );
  const [expanded, setExpanded] = useState<string | null>(null);

  if (items.length === 0) {
    return (
      <div className="empty">
        <p>Nothing queued.</p>
        <p className="muted">Scan your ingest folder or drop files to begin.</p>
      </div>
    );
  }

  return (
    <table className="ingest">
      <thead>
        <tr>
          <th></th>
          <th>File</th>
          <th>Matched as</th>
          <th>Confidence</th>
          <th>Destination</th>
          <th>Status</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <Row
            key={item.id}
            item={item}
            type={typeById.get(item.mediaTypeId)}
            expanded={expanded === item.id}
            toggle={() => setExpanded(expanded === item.id ? null : item.id)}
            disabled={props.disabled}
            onSelect={props.onSelect}
            onCandidate={props.onCandidate}
            onMatch={props.onMatch}
            onSend={props.onSend}
            onRemove={props.onRemove}
          />
        ))}
      </tbody>
    </table>
  );
}

interface RowProps extends Omit<Props, "state"> {
  item: IngestItem;
  type?: MediaTypeInfo;
  expanded: boolean;
  toggle: () => void;
}

function Row({
  item,
  type,
  expanded,
  toggle,
  disabled,
  onSelect,
  onCandidate,
  onMatch,
  onSend,
  onRemove,
}: RowProps) {
  const sel = item.match?.selected ?? {};
  const matchedLabel =
    item.match?.candidates.find(
      (c) => JSON.stringify(c.values) === JSON.stringify(sel),
    )?.displayName ?? (sel.title ? `${sel.author ?? ""} — ${sel.title}`.trim() : "—");

  return (
    <>
      <tr className={`row ${item.status}`}>
        <td>
          <button className="chev" onClick={toggle} title="Edit match">
            {expanded ? "▾" : "▸"}
          </button>
        </td>
        <td className="file">
          <div className="name">{item.rawName}</div>
          <div className="sub muted">
            {item.source} · {fmtSize(item.size)}
          </div>
        </td>
        <td className="matched">{matchedLabel.replace(/^—\s*/, "")}</td>
        <td>
          <Confidence match={item.match} />
        </td>
        <td className="dest">
          {item.destRelPath ? (
            <code>{item.destRelPath}</code>
          ) : (
            <span className="muted">—</span>
          )}
        </td>
        <td>
          <span className={`status ${item.status}`}>{item.status}</span>
          {item.error && <div className="errtext">{item.error}</div>}
        </td>
        <td className="rowactions">
          <button disabled={disabled} onClick={() => onMatch(item.id)} title="Re-match">
            ↻
          </button>
          <button
            className="send"
            disabled={disabled || !item.destRelPath || item.status === "done"}
            onClick={() => onSend(item.id)}
          >
            Send
          </button>
          <button disabled={disabled} onClick={() => onRemove(item.id)} title="Dismiss">
            ✕
          </button>
        </td>
      </tr>

      {expanded && type && (
        <tr className="editor">
          <td></td>
          <td colSpan={6}>
            <div className="editgrid">
              {type.fields.map((f) => (
                <label key={f.key}>
                  <span>
                    {f.label}
                    {f.required && <em>*</em>}
                  </span>
                  <input
                    value={sel[f.key] ?? ""}
                    disabled={disabled}
                    onChange={(e) =>
                      onSelect(item.id, { [f.key]: e.target.value })
                    }
                  />
                </label>
              ))}
            </div>

            {item.match && item.match.candidates.length > 0 && (
              <div className="candidates">
                <span className="muted">Candidates:</span>
                {item.match.candidates.map((c, i) => (
                  <button
                    key={i}
                    className="cand"
                    disabled={disabled}
                    onClick={() => onCandidate(item.id, i)}
                  >
                    {c.displayName}
                    <em>{Math.round(c.confidence * 100)}%</em>
                    <small>{c.source}</small>
                  </button>
                ))}
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
