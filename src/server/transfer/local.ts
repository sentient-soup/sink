import { access, copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Destination } from "../../shared/types.ts";
import type { Transfer } from "./transfer.ts";

/** Copies to a path on the local/mounted filesystem. */
export class LocalTransfer implements Transfer {
  constructor(private dest: Destination) {}

  async send(localPath: string, relPath: string): Promise<void> {
    const target = join(this.dest.basePath, relPath);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(localPath, target);
  }

  async test(): Promise<void> {
    await access(this.dest.basePath);
  }
}
