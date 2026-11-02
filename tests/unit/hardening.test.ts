import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  sanitizeUntrusted,
  sanitizeUntrustedList,
} from "../../src/diagnostics.js";
import {
  initialRun,
  runPath,
  runStart,
  runToolName,
} from "../../src/piui/runs.js";
import { timelinePanelLines } from "../../src/adapters/tmux/panels.js";
import { stripTerminalSequences } from "@earendil-works/pi-tui";

/** A CSI colour sequence, as a hostile tool name or path might carry. */
const CSI = "\u001b[31m";

describe("sanitizeUntrusted", () => {
  it("strips escape sequences so a crafted name cannot repaint the status line", () => {
    const hostile = `edit${CSI}mFAKE\u001b[0m`;
    const clean = sanitizeUntrusted(hostile);
    assert.ok(!clean.includes("\u001b"), "escape byte must not survive");
    // The payload survives as inert literal text, which is the point: the
    // terminal can no longer interpret it as a colour change.
    assert.equal(clean, "edit[31mmFAKE[0m");
    assert.ok(clean.startsWith("edit"));
    assert.ok(clean.endsWith("FAKE[0m"));
  });

  it("strips bidi overrides and zero-width characters", () => {
    // U+202E reverses the visual order of "gnihs" into "shing".
    const hostile = "\u202egnihs\u200b.txt";
    assert.equal(sanitizeUntrusted(hostile), "gnihs.txt");
  });

  it("strips C0 and C1 controls including BEL and DEL", () => {
    assert.equal(sanitizeUntrusted("a\u0007b\u007fc\u009bd"), "abcd");
  });

  it("preserves visible non-ASCII, unlike plain()", () => {
    // plain() would render this as "caf?/???.ts"; real paths must survive.
    assert.equal(sanitizeUntrusted("café/日本語.ts"), "café/日本語.ts");
  });

  it("turns newlines and tabs into single spaces rather than joining words", () => {
    assert.equal(sanitizeUntrusted("a\nb\tc\r\nd"), "a b c d");
  });

  it("bounds the result to the requested length", () => {
    assert.equal(sanitizeUntrusted("abcdefghij", 4), "abcd");
    assert.equal(sanitizeUntrusted("abc", 0), "");
  });

  it("returns an empty string for input that is entirely hostile", () => {
    assert.equal(sanitizeUntrusted("\u001b\u202e\u200b"), "");
    assert.equal(sanitizeUntrusted(""), "");
  });

  it("drops empty and duplicate entries while preserving order", () => {
    const out = sanitizeUntrustedList([
      "read",
      "read",
      "a\u0007b",
      "",
      "write",
    ]);
    assert.deepEqual(out, ["read", "ab", "write"]);
  });

  it("bounds the list length", () => {
    const many = Array.from({ length: 50 }, (_, i) => `t${i}`);
    assert.equal(sanitizeUntrustedList(many, 5).length, 5);
  });
});

describe("run state sanitization", () => {
  const started = () => runStart(initialRun(), 0);

  it("stores a sanitized tool name", () => {
    const s = runToolName(started(), `bash${CSI}0m`);
    assert.equal(s.toolNames.length, 1);
    assert.ok(!s.toolNames[0]!.includes("\u001b"));
  });

  it("ignores a tool name that is entirely hostile", () => {
    assert.deepEqual(runToolName(started(), "\u001b\u202e").toolNames, []);
  });

  it("stores a sanitized tool path", () => {
    const s = runPath(started(), "src/\u202eindex.ts\u0007");
    assert.equal(s.toolPaths.length, 1);
    assert.equal(s.toolPaths[0], "src/index.ts");
  });

  it("deduplicates sanitized paths so distinct hostile spellings collapse", () => {
    let s = runPath(started(), "a.ts\u0007");
    s = runPath(s, "a.ts\u001b");
    assert.deepEqual(s.toolPaths, ["a.ts"]);
  });

  it("does not record paths when the run is inactive", () => {
    assert.deepEqual(runPath(initialRun(), "a.ts").toolPaths, []);
  });
});

describe("timeline panel sanitization", () => {
  it("renders no escape sequences from agent-supplied tool names", () => {
    const lines = timelinePanelLines({
      prefix: "F12",
      busyNow: false,
      history: [
        {
          index: 1,
          seconds: 3,
          tools: 2,
          failed: 0,
          interrupted: false,
          // Bypasses run-state capture to prove the panel sanitizes too.
          toolNames: [`bash${CSI}0m`, "\u202egnihs"],
        },
      ],
    });
    const joined = stripTerminalSequences(lines.join("\n"));
    assert.ok(!joined.includes("\u001b"), "no escape may reach the panel");
    assert.ok(
      !joined.includes("\u202e"),
      "no bidi override may reach the panel",
    );
  });
});
