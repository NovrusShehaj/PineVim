#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { connect, identity } from "./client.js";
import type { MessageType } from "./protocol.js";
const [runtime, action, nonce] = process.argv.slice(2);
if (runtime && action === "popup") {
  try {
    const text = await readFile(join(runtime, "popup.txt"), "utf8");
    process.stdout.write(text.endsWith("\n") ? text : `${text}\n`);
    process.stdout.write("press a key\n");
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    process.stdin.resume();
    await new Promise<void>((resolve) => {
      process.stdin.once("data", () => resolve());
    });
  } catch {
    process.exitCode = 1;
  }
} else if (runtime && action) {
  let peer;
  try {
    peer = await connect(runtime);
    const hello = await peer.request("hello", {
      ...(await identity(runtime)),
      role: "helper",
      pid: process.pid,
    });
    let type: MessageType = "intent",
      payload: Record<string, unknown> = { intent: action };
    if (["resize", "layout", "focus", "death", "detach"].includes(action)) {
      type = "event";
      payload = { event: action };
    }
    if (action === "confirm-quit" || action === "confirm-retry") {
      type = "confirm";
      payload = { action: action.slice(8), nonce };
    }
    await peer.request(type, payload, 0, String(hello.epoch));
  } catch {
    process.exitCode = 1;
  } finally {
    peer?.close();
  }
} else process.exitCode = 1;
