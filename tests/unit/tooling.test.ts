import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildReport,
  environmentChecks,
  renderReport,
  satisfiesVersion,
  stateDirectoryFor,
  type Check,
} from "../../src/doctor.js";
import { completions, isShell, SHELLS } from "../../src/completions.js";
import { SLASH_COMMANDS, USAGE, findSlashCommand } from "../../src/commands.js";
import { parseCommand } from "../../src/adapters/pi/extension.js";
import { PineError } from "../../src/diagnostics.js";

describe("doctor version comparison", () => {
  it("accepts equal and newer versions", () => {
    assert.equal(satisfiesVersion("3.5", "3.5"), true);
    assert.equal(satisfiesVersion("3.7c", "3.5"), true);
    assert.equal(satisfiesVersion("4.0", "3.5"), true);
  });

  it("rejects older major and minor versions", () => {
    assert.equal(satisfiesVersion("3.4", "3.5"), false);
    assert.equal(satisfiesVersion("2.9", "3.5"), false);
    assert.equal(satisfiesVersion("22.18.9", "22.19.0"), false);
    assert.equal(satisfiesVersion("22.19.0", "22.19.0"), true);
  });

  it("tolerates non-numeric prefixes and suffixes", () => {
    assert.equal(satisfiesVersion("tmux 3.5", "3.5"), true);
    assert.equal(satisfiesVersion("v3.5.1", "3.5"), true);
  });
});

describe("doctor report", () => {
  it("classifies the current environment without failing to run", () => {
    const check = environmentChecks();
    assert.equal(check.findings.length, 3);
    for (const f of check.findings) assert.ok(f.label.length > 0);
  });

  it("totals findings by severity", () => {
    const report = buildReport([
      {
        name: "a",
        findings: [
          { label: "x", status: "ok", detail: "" },
          { label: "y", status: "warn", detail: "", remedy: "r" },
          { label: "z", status: "fail", detail: "", remedy: "r" },
        ],
      },
    ]);
    assert.deepEqual(report.totals, { ok: 1, warn: 1, fail: 1 });
  });

  it("renders ANSI-free text with a remedy for every non-ok finding", () => {
    const check: Check = {
      name: "deps",
      findings: [
        { label: "tmux", status: "ok", detail: "3.7c" },
        {
          label: "pi",
          status: "fail",
          detail: "0.80.0",
          remedy: "install 0.87.1",
        },
      ],
    };
    const text = renderReport(buildReport([check]));
    assert.ok(!text.includes("\u001b"), "report must be plain text");
    assert.match(text, /FAIL {2}pi/);
    assert.match(text, /-> install 0\.87\.1/);
    assert.match(text, /1 failure/);
    assert.match(text, /cannot start/);
  });

  it("reports ready when nothing failed", () => {
    const text = renderReport(
      buildReport([
        { name: "a", findings: [{ label: "x", status: "ok", detail: "1" }] },
      ]),
    );
    assert.match(text, /is ready to start/);
  });

  it("derives a stable state directory per workspace", () => {
    const a = stateDirectoryFor("/tmp/one");
    assert.equal(a, stateDirectoryFor("/tmp/one"));
    assert.notEqual(a, stateDirectoryFor("/tmp/two"));
    assert.match(a, /pinevim\/[0-9a-f]{24}$/);
  });
});

describe("completions", () => {
  it("recognizes only supported shells", () => {
    for (const s of SHELLS) assert.equal(isShell(s), true);
    assert.equal(isShell("powershell"), false);
  });

  it("emits a script for every supported shell", () => {
    for (const shell of SHELLS)
      assert.ok(completions(shell).length > 0, `${shell} must emit output`);
  });

  it("includes every registered slash subcommand", () => {
    for (const shell of SHELLS) {
      const script = completions(shell);
      for (const command of SLASH_COMMANDS)
        assert.ok(
          script.includes(command.name),
          `${shell} completions must offer "${command.name}"`,
        );
    }
  });

  it("includes the prefix chords from the live help rows", () => {
    const script = completions("bash");
    for (const chord of [
      "i",
      "c",
      "a",
      "Tab",
      "Left",
      "Right",
      "r",
      "q",
      "s",
      "t",
      "m",
    ])
      assert.ok(script.includes(chord), `bash completions must offer ${chord}`);
  });

  it("bakes in a non-default prefix", () => {
    assert.ok(completions("zsh", "C-Space").includes("C-Space"));
  });

  it("cannot break out of a quoted context via a command name", () => {
    // Registry names are validated, but the escaping is what guarantees it.
    const script = completions("zsh");
    assert.ok(
      !/\n[^\s'"]*'/.test(script.split("chords=(")[1]?.split(")")[0] ?? ""),
    );
  });
});

describe("command registry", () => {
  it("parses every registered /pinevim subcommand", () => {
    for (const command of SLASH_COMMANDS)
      assert.equal(parseCommand("pinevim", command.name), command.intent);
  });

  it("keeps the /ide aliases working", () => {
    assert.equal(parseCommand("ide", ""), "ide.open");
    assert.equal(parseCommand("ide", "open"), "ide.open");
    assert.equal(parseCommand("ide", "close"), "chat");
  });

  it("rejects unknown input with usage copy", () => {
    assert.throws(() => parseCommand("pinevim", "nonsense"), PineError);
    assert.throws(() => parseCommand("ide", "nonsense"), PineError);
  });

  it("generates the usage sentence from the registry", () => {
    assert.ok(USAGE.includes("agent hide"));
    assert.ok(findSlashCommand("status")?.intent === "status");
    assert.equal(findSlashCommand("nope"), undefined);
  });
});
