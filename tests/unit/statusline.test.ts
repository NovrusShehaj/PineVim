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
  timelinePanelLines,
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
    assert.match(value, /#\[fg=/);
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
      versions: { pi: "0.87.1", tmux: "3.5a", node: "26.1.0" },
      editorNote: null,
      prefix: "F12",
    }).map((l) => l);
    const bare = stripTerminalSequences(lines.join("\n"));
    assert.match(bare, /workspace/);
    assert.match(bare, /--resume/);
    assert.match(bare, /0\.87\.1/);
    assert.match(bare, /CHAT · agent/);
    assert.match(bare, /Pi 0\.87\.1 · tmux 3\.5a/);
    assert.match(bare, /node\s+Node 26\.1\.0/);
  });
  it("help lists slash commands", () => {
    const bare = helpPanelLines("F12").join("\n");
    assert.match(bare, /\/pinevim help/);
    assert.match(bare, /\/ide/);
  });
  it("panels have a complete ASCII fallback", () => {
    const help = stripTerminalSequences(helpPanelLines("F12", true).join("\n"));
    const status = stripTerminalSequences(
      statusPanelLines(
        liveState(),
        {
          workspace: "/tmp/ws",
          session: "abc123",
          bridge: true,
          slash: { ide: true, pinevim: true },
          versions: { pi: "0.87.1", tmux: "3.7c", node: "22.19.0" },
          editorNote: null,
          prefix: "F12",
        },
        true,
      ).join("\n"),
    );
    for (const bare of [help, status]) {
      assert.ok(
        [...bare].every((ch) => (ch.codePointAt(0) ?? 0) <= 0x7f),
        "ASCII panel mode emitted a non-ASCII glyph",
      );
    }
    assert.match(help, /NAVIGATE/);
    assert.match(help, /press any key to close/);
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
    const items = argv.slice(3);
    assert.equal(items.length % 3, 0);
    for (let i = 2; i < items.length; i += 3) {
      assert.match(items[i] ?? "", /^run-shell -b "/);
      assert.match(items[i] ?? "", /"$/);
    }
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
  it("timeline panel renders bounded rows, live marker and empty state", () => {
    const plain = (lines: string[]) =>
      lines.map((l) => stripTerminalSequences(l).trimEnd());
    const empty = plain(
      timelinePanelLines({ prefix: "F12", busyNow: false, history: [] }),
    );
    assert.match(empty.join("\n"), /no runs yet this session/);
    const busy = plain(
      timelinePanelLines({
        prefix: "F12",
        busyNow: true,
        history: [
          {
            index: 1,
            seconds: 5.4,
            tools: 2,
            failed: 0,
            interrupted: false,
            toolNames: ["read", "bash"],
          },
          {
            index: 2,
            seconds: 12,
            tools: 3,
            failed: 1,
            interrupted: true,
            toolNames: [],
          },
        ],
      }),
    );
    assert.match(busy.join("\n"), /run 1.*5s.*tools 2.*read bash/);
    assert.match(busy.join("\n"), /run 2.*12s.*fail 1.*stopped/);
    assert.match(busy.join("\n"), /live.*running now/);
    for (const line of busy)
      assert.ok([...line].length <= 48, `timeline line overflowed: ${line}`);
    const ascii = plain(
      timelinePanelLines({ prefix: "F12", busyNow: false, history: [] }, true),
    );
    assert.ok(
      ascii.every((l) =>
        [...l].every((ch) => (ch.codePointAt(0) ?? 0) <= 0x7f),
      ),
      "ascii timeline emitted non-ascii",
    );
  });
  it("menu and help expose the session timeline binding", () => {
    const entries = menuEntries("F12");
    const timeline = entries.find((e) => e.intent === "timeline");
    assert.ok(timeline, "timeline menu entry missing");
    assert.equal(timeline.key, "t");
    assert.ok(
      helpPanelLines("F12", false).some((l) => l.includes("session timeline")),
    );
    assert.ok(menuEntries("F12").length <= 8, "tmux menu hard limit is 8");
  });
});
