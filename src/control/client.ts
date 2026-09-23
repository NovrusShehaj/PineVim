import { createConnection } from "node:net";
import { join } from "node:path";
import { privatePath, privateRead } from "../persistence.js";
import { Peer } from "./protocol.js";
import { PineError } from "../diagnostics.js";
export async function connect(runtime: string): Promise<Peer> {
  await privatePath(runtime, "directory");
  const socket = createConnection(join(runtime, "control.sock"));
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.destroy();
      reject(
        new PineError(
          "DISCONNECTED",
          "Controller unavailable; use pinevim --resume.",
        ),
      );
    }, 2000);
    socket.once("connect", () => {
      clearTimeout(timer);
      resolve(new Peer(socket));
    });
    socket.once("error", () => {
      clearTimeout(timer);
      reject(
        new PineError(
          "DISCONNECTED",
          "Controller unavailable; use pinevim --resume.",
        ),
      );
    });
  });
}
export async function identity(
  runtime: string,
): Promise<{ token: string; instance: string }> {
  const token = await privateRead(join(runtime, "token"));
  const id = JSON.parse(await privateRead(join(runtime, "identity.json"))) as {
    instance: string;
  };
  return { token, instance: id.instance };
}
