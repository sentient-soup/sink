import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { Client, type SFTPWrapper } from "ssh2";
import type { Destination } from "../../shared/types.ts";
import type { Transfer } from "./transfer.ts";

const posix = path.posix;

/** Copies over SSH/SFTP, creating remote directories as needed. */
export class SshTransfer implements Transfer {
  constructor(private dest: Destination) {}

  private async connect(): Promise<{ conn: Client; sftp: SFTPWrapper }> {
    const cfg = this.dest.ssh;
    if (!cfg) throw new Error("Destination is missing SSH configuration");
    const privateKey = cfg.privateKeyPath
      ? await readFile(cfg.privateKeyPath)
      : undefined;

    return new Promise((resolve, reject) => {
      const conn = new Client();
      conn
        .on("ready", () => {
          conn.sftp((err, sftp) => {
            if (err) {
              conn.end();
              reject(err);
            } else resolve({ conn, sftp });
          });
        })
        .on("error", reject)
        .connect({
          host: cfg.host,
          port: cfg.port || 22,
          username: cfg.username,
          password: cfg.password || undefined,
          privateKey,
        });
    });
  }

  private mkdirp(sftp: SFTPWrapper, dir: string): Promise<void> {
    const parts = dir.split("/").filter(Boolean);
    let cur = dir.startsWith("/") ? "/" : "";
    const next = (i: number): Promise<void> =>
      i >= parts.length
        ? Promise.resolve()
        : new Promise<void>((resolve, reject) => {
            cur = posix.join(cur, parts[i]);
            // Ignore "already exists"; reject only on real errors.
            sftp.mkdir(cur, (err: any) =>
              err && err.code !== 4 && !/exists/i.test(err.message ?? "")
                ? reject(err)
                : resolve(),
            );
          }).then(() => next(i + 1));
    return next(0);
  }

  async send(localPath: string, relPath: string): Promise<void> {
    const target = posix.join(this.dest.basePath.replace(/\\/g, "/"), relPath);
    const { conn, sftp } = await this.connect();
    try {
      await this.mkdirp(sftp, posix.dirname(target));
      await new Promise<void>((resolve, reject) =>
        sftp.fastPut(localPath, target, (err) => (err ? reject(err) : resolve())),
      );
    } finally {
      conn.end();
    }
  }

  async writeText(relPath: string, content: string): Promise<void> {
    const target = posix.join(this.dest.basePath.replace(/\\/g, "/"), relPath);
    const { conn, sftp } = await this.connect();
    try {
      await this.mkdirp(sftp, posix.dirname(target));
      await new Promise<void>((resolve, reject) =>
        sftp.writeFile(target, content, "utf8", (err) =>
          err ? reject(err) : resolve(),
        ),
      );
    } finally {
      conn.end();
    }
  }

  async test(): Promise<void> {
    const { conn, sftp } = await this.connect();
    try {
      await new Promise<void>((resolve, reject) =>
        sftp.readdir(this.dest.basePath.replace(/\\/g, "/"), (err) =>
          err ? reject(err) : resolve(),
        ),
      );
    } finally {
      conn.end();
    }
  }
}
