import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import type { Socket } from "node:net";
import { PineError } from "../diagnostics.js";
import { intents } from "../core/state.js";
export const MAX_RECORD = 16 * 1024,
  MAX_QUEUE = 64,
  ACK_MS = 2000,
  OP_MS = 10000;
export const messageTypes = [
  "hello",
  "intent",
  "status",
  "event",
  "shutdown",
  "confirm",
  "ack",
  "result",
] as const;
export type MessageType = (typeof messageTypes)[number];
export interface RecordMessage {
  version: 1;
  requestId: string;
  generation: number;
  epoch: string;
  type: MessageType;
  payload: Record<string, unknown>;
}
function object(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
function text(v: unknown, max = 4096): v is string {
  return typeof v === "string" && v.length <= max && !v.includes("\0");
}
export function parseRecord(line: string): RecordMessage {
  if (Buffer.byteLength(line) > MAX_RECORD)
    throw new PineError("PROTOCOL", "Control record exceeds 16 KiB.");
  let v: unknown;
  try {
    v = JSON.parse(line);
  } catch {
    throw new PineError("PROTOCOL", "Malformed control JSON.");
  }
  if (
    !object(v) ||
    Object.keys(v).some(
      (k) =>
        ![
          "version",
          "requestId",
          "generation",
          "epoch",
          "type",
          "payload",
        ].includes(k),
    ) ||
    v.version !== 1 ||
    !text(v.requestId, 80) ||
    !/^[a-zA-Z0-9-]+$/.test(v.requestId) ||
    !Number.isSafeInteger(v.generation) ||
    Number(v.generation) < 0 ||
    !text(v.epoch, 80) ||
    !messageTypes.includes(v.type as MessageType) ||
    !object(v.payload)
  )
    throw new PineError("PROTOCOL", "Invalid control record schema.");
  const p = v.payload;
  const allowed: Record<MessageType, string[]> = {
    hello: [
      "token",
      "instance",
      "role",
      "pid",
      "cwd",
      "ide",
      "pinevim",
      "sessionId",
      "sessionFile",
      "busy",
      "telemetry",
    ],
    intent: ["intent"],
    status: [
      "sessionId",
      "sessionFile",
      "busy",
      "ide",
      "pinevim",
      "cwd",
      "telemetry",
    ],
    event: ["event"],
    shutdown: ["cancel"],
    confirm: ["nonce", "action"],
    ack: [],
    result: ["ok", "code", "message", "epoch", "generation"],
  };
  if (Object.keys(p).some((k) => !allowed[v.type as MessageType].includes(k)))
    throw new PineError("PROTOCOL", "Unknown control payload field.");
  let valid = true;
  switch (v.type) {
    case "hello":
      valid =
        text(p.token, 64) &&
        /^[a-f0-9]{64}$/.test(p.token) &&
        text(p.instance, 32) &&
        /^[a-f0-9]{32}$/.test(p.instance) &&
        (p.role === "bridge" || p.role === "helper") &&
        Number.isSafeInteger(p.pid) &&
        Number(p.pid) > 0;
      break;
    case "intent":
      valid = intents.includes(p.intent as (typeof intents)[number]);
      break;
    case "event":
      valid = ["resize", "layout", "focus", "death", "detach"].includes(
        String(p.event),
      );
      break;
    case "shutdown":
      valid = typeof p.cancel === "boolean";
      break;
    case "confirm":
      valid =
        text(p.nonce, 80) && (p.action === "quit" || p.action === "retry");
      break;
    case "result":
      valid =
        typeof p.ok === "boolean" &&
        (p.message === undefined || text(p.message, 512)) &&
        (p.code === undefined || text(p.code, 40)) &&
        (p.epoch === undefined || text(p.epoch, 80));
      break;
  }
  for (const k of ["busy", "ide", "pinevim"])
    if (p[k] !== undefined && typeof p[k] !== "boolean") valid = false;
  for (const k of ["cwd", "sessionFile"])
    if (p[k] !== undefined && p[k] !== null && !text(p[k])) valid = false;
  // Additive telemetry line (v1.1): `lifecycle|run|failed|turn|wait|ctx`.
  // Bounded ASCII; malformed values are rejected (the controller then falls
  // back to the busy bit rather than rendering untrusted content).
  if (p.telemetry !== undefined) {
    if (!text(p.telemetry, 64) || !/^[a-z|0-9-]+$/.test(p.telemetry as string))
      valid = false;
  }
  if (
    p.sessionId !== undefined &&
    p.sessionId !== null &&
    !text(p.sessionId, 256)
  )
    valid = false;
  if (v.type === "status" || (v.type === "hello" && p.role === "bridge")) {
    valid =
      valid &&
      text(p.cwd) &&
      typeof p.busy === "boolean" &&
      typeof p.ide === "boolean" &&
      typeof p.pinevim === "boolean" &&
      (p.sessionId === null || text(p.sessionId, 256)) &&
      (p.sessionFile === null || text(p.sessionFile));
  }
  if (
    p.generation !== undefined &&
    (!Number.isSafeInteger(p.generation) || Number(p.generation) < 0)
  )
    valid = false;
  if (!valid) throw new PineError("PROTOCOL", "Invalid control payload.");
  return v as unknown as RecordMessage;
}
export class Framer {
  private buffer = Buffer.alloc(0);
  feed(chunk: Buffer): RecordMessage[] {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const messages: RecordMessage[] = [];
    let index: number;
    while ((index = this.buffer.indexOf(10)) >= 0) {
      if (index > MAX_RECORD)
        throw new PineError("PROTOCOL", "Control record exceeds 16 KiB.");
      messages.push(
        parseRecord(this.buffer.subarray(0, index).toString("utf8")),
      );
      this.buffer = this.buffer.subarray(index + 1);
      if (messages.length > MAX_QUEUE)
        throw new PineError("QUEUE", "Control queue full.");
    }
    if (this.buffer.length > MAX_RECORD)
      throw new PineError("PROTOCOL", "Control record exceeds 16 KiB.");
    return messages;
  }
}
interface Pending {
  resolve: (p: Record<string, unknown>) => void;
  reject: (e: Error) => void;
  ack: NodeJS.Timeout;
  deadline: NodeJS.Timeout;
  generation: number;
  epoch: string;
}
export class Peer extends EventEmitter {
  private pending = new Map<string, Pending>();
  private seen = new Set<string>();
  private incoming = 0;
  private framer = new Framer();
  closed = false;
  handler: (m: RecordMessage) => Promise<Record<string, unknown>> =
    async () => {
      throw new PineError("PROTOCOL", "No request handler.");
    };
  constructor(readonly socket: Socket) {
    super();
    socket.on("error", () => this.close());
    socket.on("close", () => this.close());
    socket.on("data", (chunk: Buffer) => {
      try {
        for (const m of this.framer.feed(chunk)) this.receive(m);
      } catch {
        this.close();
      }
    });
  }
  private send(m: RecordMessage): void {
    const line = JSON.stringify(m);
    if (
      this.closed ||
      Buffer.byteLength(line) > MAX_RECORD ||
      this.socket.writableLength > MAX_RECORD * MAX_QUEUE
    )
      throw new PineError("DISCONNECTED", "Control connection unavailable.");
    this.socket.write(line + "\n");
  }
  request(
    type: MessageType,
    payload: Record<string, unknown>,
    generation = 0,
    epoch = "",
  ): Promise<Record<string, unknown>> {
    if (this.pending.size >= MAX_QUEUE || this.closed)
      return Promise.reject(
        new PineError("QUEUE", "Control connection unavailable or queue full."),
      );
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      const expire = () => {
        const p = this.pending.get(requestId);
        if (p) {
          clearTimeout(p.ack);
          clearTimeout(p.deadline);
          this.pending.delete(requestId);
          reject(
            new PineError(
              "TIMEOUT",
              "Control operation timed out; it may have completed. Reconcile status before trying again.",
            ),
          );
        }
      };
      this.pending.set(requestId, {
        resolve,
        reject,
        ack: setTimeout(expire, ACK_MS),
        deadline: setTimeout(expire, OP_MS),
        generation,
        epoch,
      });
      try {
        this.send({ version: 1, requestId, generation, epoch, type, payload });
      } catch (e) {
        expire();
        reject(e);
      }
    });
  }
  private receive(m: RecordMessage): void {
    if (m.type === "ack" || m.type === "result") {
      const p = this.pending.get(m.requestId);
      if (!p) return;
      if (p.generation !== m.generation || p.epoch !== m.epoch) {
        this.close();
        return;
      }
      clearTimeout(p.ack);
      if (m.type === "result") {
        clearTimeout(p.deadline);
        this.pending.delete(m.requestId);
        if (m.payload.ok) p.resolve(m.payload);
        else
          p.reject(
            new PineError(
              String(m.payload.code ?? "REMOTE"),
              String(m.payload.message ?? "Control request rejected."),
            ),
          );
      }
      return;
    }
    // Duplicates are never executed twice; no retransmission/replay after lost replies.
    if (
      this.seen.has(m.requestId) ||
      this.incoming >= MAX_QUEUE ||
      this.seen.size >= 1024
    ) {
      this.close();
      return;
    }
    this.seen.add(m.requestId);

    this.incoming++;
    this.send({ ...m, type: "ack", payload: {} });
    void this.handler(m)
      .then(
        (payload) =>
          this.send({
            ...m,
            type: "result",
            payload: { ...payload, ok: true },
          }),
        (e) =>
          this.send({
            ...m,
            type: "result",
            payload: {
              ok: false,
              code: e instanceof PineError ? e.code : "OPERATION",
              message:
                e instanceof PineError
                  ? e.message
                  : "Control operation failed; processes preserved.",
            },
          }),
      )
      .catch(() => this.close())
      .finally(() => {
        this.incoming--;
      });
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.socket.destroy();
    for (const p of this.pending.values()) {
      clearTimeout(p.ack);
      clearTimeout(p.deadline);
      p.reject(
        new PineError(
          "DISCONNECTED",
          "Control disconnected; outstanding actions are discarded, not replayed.",
        ),
      );
    }
    this.pending.clear();
    this.emit("closed");
  }
}
