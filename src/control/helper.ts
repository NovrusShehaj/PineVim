#!/usr/bin/env node
import { connect, identity } from "./client.js";
import type { MessageType } from "./protocol.js";
const [runtime, action, nonce] = process.argv.slice(2);
if (runtime && action) {
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
