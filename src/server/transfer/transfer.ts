import type { Destination } from "../../shared/types.ts";

/** Moves a staged/scanned file to its computed location on a destination. */
export interface Transfer {
  /** @param relPath forward-slash path relative to the destination base. */
  send(localPath: string, relPath: string): Promise<void>;
  /** Write a small text file (e.g. a sidecar) at a destination-relative path. */
  writeText(relPath: string, content: string): Promise<void>;
  /** Cheap reachability check for the settings UI. */
  test(): Promise<void>;
}

export interface TransferFactory {
  (dest: Destination): Transfer;
}
