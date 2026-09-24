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
  menuDisplayArgv,
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
    const bare = stripTerminalSequences(line).replace(/#\[[^\]]*\]/g, "");
    assert.match(bare, /agent tooling 3/);
    assert.doesNotMatch(bare, /ctx 41%/);
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
    assert.match(bare, /prefix r after confirmation/);
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
    assert.doesNotMatch(bare, /tooling/);
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
    assert.ok(value.includes("we##ird"));
    assert.equal(value.includes("\u001b"), false);
    assert.match(value, /#\[fg=colour/);
  });
  it("no-color mode omits style tokens", () => {
    const value = statusOptionValue(
      {
        state: liveState(),
        workspace: "/tmp/ws",
        prefix: "F12",
        telemetry: null,
        ascii: true,
      },
      false,
    );
    assert.equal(value.includes("#["), false);
    assert.match(value, /\* agent/);
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
  it("help lists slash commands", () => {
    const bare = helpPanelLines("F12").join("\n");
    assert.match(bare, /\/pinevim help/);
    assert.match(bare, /\/ide/);
  });
  it("status popup uses telemetry waiting text", () => {
    const s = liveState();
    const bare = statusPanelLines(s, {
      workspace: "/tmp/ws",
      session: null,
      bridge: true,
      slash: { ide: true, pinevim: true },
      versions: { pi: "0.87.1", tmux: "3.5", node: "22" },
      editorNote: null,
      prefix: "F12",
      telemetry: {
        lifecycle: "waiting",
        toolsRun: 0,
        toolsFailed: 0,
        turnIndex: 1,
        waitingKind: "confirm",
        ctxPercent: null,
      },
    }).join("\n");
    assert.match(bare, /needs you \(confirm\)/);
  });
  it("menu argv runs helper commands and does not send intent menu", () => {
    const argv = menuDisplayArgv("/usr/bin/node", "/helper.js", "/rt", "F12");
    assert.ok(argv.some((part) => part.includes("ide.open")));
    assert.equal(argv.includes("menu"), false);
    assert.equal(argv.join(" ").includes("read -n"), false);
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
