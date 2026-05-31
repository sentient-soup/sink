import type { Destination } from "../../shared/types.ts";
import { LocalTransfer } from "./local.ts";
import { SshTransfer } from "./ssh.ts";
import type { Transfer } from "./transfer.ts";

export type { Transfer } from "./transfer.ts";

/** Pick the transfer implementation for a destination's kind. */
export function createTransfer(dest: Destination): Transfer {
  return dest.kind === "ssh" ? new SshTransfer(dest) : new LocalTransfer(dest);
}
