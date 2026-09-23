import { createServer, type Server } from "node:net";
import { chmod, lstat, unlink } from "node:fs/promises";
import { timingSafeEqual } from "node:crypto";
import { join } from "node:path";
import { Peer, type RecordMessage } from "./protocol.js";
import { identity } from "./client.js";
import { PineError } from "../diagnostics.js";
export interface ClientIdentity {
  role: "bridge" | "helper";
  generation: number;
  pid: number;
}
export class ControlServer {
  private server: Server | null = null;
  private peers = new Set<Peer>();
  constructor(
    readonly runtime: string,
    readonly epoch: string,
    private handler: (
      peer: Peer,
      client: ClientIdentity,
      m: RecordMessage,
    ) => Promise<Record<string, unknown>>,
  ) {}
  async listen(): Promise<void> {
    const auth = await identity(this.runtime);
    const path = join(this.runtime, "control.sock");
    // Caller owns exclusive workspace lock and has validated runtime identity.
    try {
      const s = await lstat(path);
      if (!s.isSocket() || s.uid !== process.getuid?.())
        throw new PineError("SOCKET", "Unsafe control socket path.");
      await unlink(path);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    this.server = createServer((socket) => {
      if (this.peers.size >= 64) {
        socket.destroy();
        return;
      }
      const peer = new Peer(socket);
      this.peers.add(peer);
      let client: ClientIdentity | null = null;
      const timer = setTimeout(() => peer.close(), 2000);
      peer.on("closed", () => {
        clearTimeout(timer);
        this.peers.delete(peer);
      });
      peer.handler = async (m) => {
        if (!client) {
          const token = m.payload.token;
          if (
            m.type !== "hello" ||
            m.epoch !== "" ||
            typeof token !== "string" ||
            token.length !== auth.token.length ||
            !timingSafeEqual(Buffer.from(token), Buffer.from(auth.token)) ||
            m.payload.instance !== auth.instance
          ) {
            peer.close();
            throw new PineError("AUTH", "Control authentication rejected.");
          }
          client = {
            role: m.payload.role as ClientIdentity["role"],
            generation: m.generation,
            pid: Number(m.payload.pid),
          };
          clearTimeout(timer);
          try {
            const result = await this.handler(peer, client, m);
            return { ...result, epoch: this.epoch };
          } catch (e) {
            client = null;
            setImmediate(() => peer.close());
            throw e;
          }
        }
        if (
          m.type === "hello" ||
          m.epoch !== this.epoch ||
          m.generation !== client.generation
        )
          throw new PineError(
            "STALE",
            "Stale controller epoch or bridge generation; reconnect.",
          );
        return await this.handler(peer, client, m);
      };
    });
    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(path, () => resolve());
    });
    await chmod(path, 0o600);
  }
  async close(): Promise<void> {
    for (const p of this.peers) p.close();
    if (this.server)
      await new Promise<void>((resolve) => this.server!.close(() => resolve()));
  }
}
