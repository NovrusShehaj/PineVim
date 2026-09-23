import { appendFileSync } from "node:fs";
import {
  CustomEditor,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import {
  createAssistantMessageEventStream,
  type AssistantMessage,
} from "@earendil-works/pi-ai";
export default function (pi: ExtensionAPI) {
  const record = (event: string, data: Record<string, unknown> = {}) =>
    appendFileSync(
      process.env.PINEVIM_FIXTURE_RECORD!,
      JSON.stringify({ event, ...data }) + "\n",
    );
  let failNext = false;
  pi.registerCommand("fixture-error", {
    handler: async () => {
      failNext = true;
      record("error-armed");
    },
  });
  pi.registerProvider("pine-fixture", {
    baseUrl: "https://invalid.invalid",
    apiKey: "PINEVIM_TEST_CANARY_NOT_A_REAL_KEY",
    api: "pine-fixture",
    models: ["one", "two"].map((id) => ({
      id,
      name: id,
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 32000,
      maxTokens: 1024,
    })),
    streamSimple: (model, _context, options) => {
      const stream = createAssistantMessageEventStream();
      record("request", { model: model.id });
      const message: AssistantMessage = {
        role: "assistant",
        content: [{ type: "text", text: "Fixture response" }],
        api: model.api,
        provider: model.provider,
        model: model.id,
        usage: {
          input: 1,
          output: 1,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 2,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "stop",
        timestamp: Date.now(),
      };
      stream.push({ type: "start", partial: message });
      if (failNext) {
        failNext = false;
        queueMicrotask(() => {
          message.stopReason = "error";
          message.errorMessage = "Synthetic provider unavailable";
          stream.push({ type: "error", reason: "error", error: message });
          stream.end();
          record("provider-error");
        });
        return stream;
      }
      const timer = setTimeout(() => {
        stream.push({ type: "done", reason: "stop", message });
        stream.end();
        record("settled");
      }, 2000);
      options?.signal?.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          message.stopReason = "aborted";
          stream.push({ type: "error", reason: "aborted", error: message });
          stream.end();
          record("abort");
        },
        { once: true },
      );
      return stream;
    },
  });
  pi.on("session_start", (_event, ctx) => {
    ctx.ui.setEditorComponent(
      (tui, theme, keys) => new CustomEditor(tui, theme, keys),
    );
    record("session", {
      id: ctx.sessionManager.getSessionId(),
      file: ctx.sessionManager.getSessionFile(),
      model: ctx.model?.id,
    });
  });
  pi.registerShortcut("ctrl+l", {
    handler: async (ctx) => {
      record("picker-open");
      const result = await ctx.ui.custom<boolean>(
        (_tui, _theme, _keys, done) => ({
          render: () => ["Select fixture model two: Enter"],
          invalidate() {},
          handleInput() {
            done(true);
          },
        }),
      );
      if (result) {
        const model = ctx.modelRegistry.find("pine-fixture", "two");
        if (model) await pi.setModel(model);
      }
      record("picker-close", { model: ctx.model?.id });
    },
  });
  pi.on("model_select", (event) => record("model", { model: event.model.id }));
  pi.registerCommand("fixture-fork", {
    handler: async (_args, ctx) => {
      const entry = ctx.sessionManager
        .getEntries()
        .find((e) => e.type === "message" && e.message.role === "user");
      if (!entry) throw new Error("Fixture has no user entry");
      await ctx.fork(entry.id, { position: "at" });
      record("fork-done");
    },
  });
  pi.registerCommand("fixture-resume", {
    handler: async (args, ctx) => {
      await ctx.switchSession(args);
      record("resume-done");
    },
  });
  pi.registerCommand("fixture-status", {
    handler: async (_args, ctx) => {
      record("status", {
        id: ctx.sessionManager.getSessionId(),
        file: ctx.sessionManager.getSessionFile(),
        model: ctx.model?.id,
      });
    },
  });
}
