import { appendFileSync } from "node:fs";
import {
  CustomEditor,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
const record = (data: unknown) =>
  appendFileSync(
    process.env.PINEVIM_FIXTURE_RECORD!,
    JSON.stringify(data) + "\n",
  );
export default function (pi: ExtensionAPI) {
  pi.registerCommand("ide", {
    handler: async () => {
      record({ event: "ide", pid: process.pid });
    },
  });
  pi.registerCommand("pinevim", { handler: async () => {} });
  pi.registerShortcut("ctrl+l", {
    handler: async (ctx) => {
      record({ event: "picker-open" });
      await ctx.ui.custom((_tui, _theme, _keys, done) => ({
        render: () => ["FIXTURE PICKER"],
        invalidate() {},
        handleInput() {
          done(undefined);
        },
      }));
      record({ event: "picker-close" });
    },
  });
  pi.on("session_start", (_event, ctx) => {
    ctx.ui.setEditorComponent(
      (tui, theme, kb) => new CustomEditor(tui, theme, kb),
    );
    record({
      event: "start",
      pid: process.pid,
      cwd: ctx.cwd,
      commands: pi.getCommands().map((c) => ({
        name: c.name,
        source: c.source,
        path: c.sourceInfo?.path,
      })),
    });
  });
  pi.on("input", (event) => {
    record({ event: "input", source: event.source });
    return { action: "handled" };
  });
}
