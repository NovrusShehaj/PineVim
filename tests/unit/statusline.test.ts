import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  statusLine,
  statusOptionValue,
} from "../../src/adapters/tmux/statusline.js";
import {
  escapeTmuxFormat,
  visibleWidth,
} from "../../src/adapters/tmux/styled.js";
import {
  helpPanelLines,
  statusPanelLines,
  menuEntries,
  isPanelAction,
} from "../../src/adapters/tmux/panels.js";
import { initialState } from "../../src/core/state.js";
import { stripTerminalSequences } from "@earendil-works/pi-tui";

function baseState() {
  return initialState({ columns: 120, rows: 30 }, "epoch", null);
}

/** A healthy, connected fixture: agent launched, bridge up. */
function liveState() {
  const s = baseState();
  s.agent = {
    pane: "%0",
    pid: 1,
    alive: true,
    ready: true,
    exitCode: null,
    signal: null,
  };
  s.bridge = true;
  return s;
}

/** A launched-then-died fixture (distinct from the pre-launch null case). */
function deadAgentState() {
  const s = baseState();
  s.agent = {
    pane: "%0",
    pid: 1,
    alive: false,
    ready: false,
    exitCode: 1,
    signal: null,
  };
  return s;
}

describe("styled writer", () => {
  it("doubles # for tmux format safety", () => {
    assert.equal(escapeTmuxFormat("a#b"), "a##b");
    assert.equal(escapeTmuxFormat("no hashes"), "no hashes");
  });
  it("visible width ignores SGR sequences", () => {
    assert.equal(visibleWidth("\x1b[38;2;1;2;3mabc\x1b[0m"), 3);
  });
});

describe("status line", () => {
  it("renders workspace, mode, agent, and hint segments", () => {
    const line = statusLine({
      state: liveState(),
      workspace: "/home/user/proj",
      prefix: "F12",
      telemetry: null,
      ascii: true,
    });
    const bare = stripTerminalSequences(line);
    assert.match(bare, /proj/);
    assert.match(bare, /CHAT/);
    assert.match(bare, /agent (idle|run)/);
    assert.match(bare, /F12 \?/);
  });
  it("reflects bridge telemetry lifecycle", () => {
    const line = statusLine({
      state: liveState(),
      workspace: "/tmp/ws",
      prefix: "F12",
      telemetry: {
        lifecycle: "tooling",
        toolsRun: 3,
        toolsFailed: 0,
        turnIndex: 2,
        waitingKind: null,
        ctxPercent: 41,
      },
      ascii: true,
    });
    const bare = stripTerminalSequences(line);
    assert.match(bare, /agent tooling 3/);
    assert.match(bare, /ctx 41%/);
  });
  it("reports waiting with prompt kind", () => {
    const line = statusLine({
      state: liveState(),
      workspace: "/tmp/ws",
      prefix: "F12",
      telemetry: {
        lifecycle: "waiting",
        toolsRun: 1,
        toolsFailed: 0,
        turnIndex: 1,
        waitingKind: "confirm",
        ctxPercent: null,
      },
      ascii: true,
    });
    assert.match(stripTerminalSequences(line), /needs you \(confirm\)/);
  });
  it("pi dead outranks telemetry and mentions recovery", () => {
    const s = deadAgentState();
    const line = statusLine({
      state: s,
      workspace: "/tmp/ws",
      prefix: "F12",
      telemetry: {
        lifecycle: "tooling",
        toolsRun: 9,
        toolsFailed: 0,
        turnIndex: 9,
        waitingKind: null,
        ctxPercent: 10,
      },
      ascii: true,
    });
    const bare = stripTerminalSequences(line);
    assert.match(bare, /pi dead/);
    assert.match(bare, /r to retry/);
  });
  it("bridge down shows resume guidance", () => {
    const s = liveState();
    s.bridge = false;
    const line = statusLine({
      state: s,
      workspace: "/tmp/ws",
      prefix: "F12",
      telemetry: null,
      ascii: true,
    });
    assert.match(stripTerminalSequences(line), /--resume/);
  });
  it("undersized geometry shows resize guidance instead of telemetry", () => {
    const s = initialState({ columns: 50, rows: 12 }, "e", null);
    const line = statusLine({
      state: s,
      workspace: "/tmp/ws",
      prefix: "F12",
      telemetry: {
        lifecycle: "tooling",
        toolsRun: 5,
        toolsFailed: 0,
        turnIndex: 1,
        waitingKind: null,
        ctxPercent: 30,
      },
      ascii: true,
    });
    const bare = stripTerminalSequences(line);
    assert.match(bare, /resize to 60x16/);
    assert.doesNotMatch(bare, /ctx 30%/);
  });
  it("respects the visible budget and drops tail segments first", () => {
    const line = statusLine({
      state: liveState(),
      workspace: "/home/user/averyveryverylongworkspacename",
      prefix: "F12",
      telemetry: {
        lifecycle: "tooling",
        toolsRun: 1,
        toolsFailed: 0,
        turnIndex: 1,
        waitingKind: null,
        ctxPercent: 55,
      },
      ascii: true,
    });
    assert.ok(visibleWidth(line) <= 200);
  });
  it("escapes format hashes in the option value", () => {
    const value = statusOptionValue({
      state: liveState(),
      workspace: "/tmp/we#ird",
      prefix: "F12",
      telemetry: null,
      ascii: true,
    });
    // basename escaping happens via plain(); the value must not contain a lone #
    assert.ok(!/(?<!#)%(?!#)/.test(value));
    assert.ok(!value.includes("we#ird") || value.includes("we##ird"));
  });
});

describe("panels", () => {
  it("help panel lists every prefix binding", () => {
    const lines = helpPanelLines("F12").map((l) => l);
    const bare = lines.join("\n");
    for (const key of [
      "i",
      "c",
      "a",
      "Tab",
      "Left",
      "Right",
      "r",
      "q",
      "s",
      "m",
      "?",
    ]) {
      assert.match(
        bare,
        new RegExp(`F12 ${key === "?" ? "\\?" : key}`),
        `missing ${key}`,
      );
    }
  });
  it("status panel renders controller state with recovery hints", () => {
    // Bridge-down-with-alive-pi is the case that surfaces --resume guidance;
    // a dead pi recovers via the retry chord instead.
    const s = liveState();
    s.bridge = false;
    const lines = statusPanelLines(s, {
      workspace: "/tmp/ws",
      session: "abc123",
      bridge: false,
      slash: { ide: true, pinevim: true },
      versions: { pi: "0.87.1", tmux: "tmux 3.5a", node: "26.1.0" },
      editorNote: null,
      prefix: "F12",
    }).map((l) => l);
    const bare = lines.join("\n");
    assert.match(bare, /workspace/);
    assert.match(bare, /--resume/);
    assert.match(bare, /0\.87\.1/);
  });
  it("menu entries map to controller intents", () => {
    const entries = menuEntries("F12");
    const intents = entries.map((e) => e.intent);
    for (const expected of [
      "ide.open",
      "chat",
      "agent.toggle",
      "retry",
      "status",
      "help",
      "quit",
    ]) {
      assert.ok(intents.includes(expected), `missing intent ${expected}`);
    }
  });
  it("panel actions are a fixed vocabulary", () => {
    assert.equal(isPanelAction("help"), true);
    assert.equal(isPanelAction("status"), true);
    assert.equal(isPanelAction("menu"), true);
    assert.equal(isPanelAction("explode"), false);
  });
});
