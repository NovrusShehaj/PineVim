import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { validateConfig } from "../../src/config.js";
import { PineError, recoveryCopy, userFacing } from "../../src/diagnostics.js";
import { Peer } from "../../src/control/protocol.js";
import { styledChipLine, contextGauge } from "../../src/piui/chips.js";
import { parseNumstat, formatChangeSummary } from "../../src/piui/changes.js";
import { planReport } from "../../src/piui/report-gate.js";
import {
  initialRun,
  runClose,
  runPath,
  runStart,
  runTools,
  toolWritePath,
} from "../../src/piui/runs.js";
import { reviewOptions } from "../../src/piui/local-commands.js";
import { autoPinevimTheme } from "../../src/piui/theme.js";
import {
  draftFromTools,
  listSkills,
  saveProposal,
  validateSkill,
} from "../../src/skills/registry.js";

describe("bridge seen window", () => {
  it("stays open across 1100 ids and ignores an in-window duplicate", async () => {
    const socket = new EventEmitter();
    let writes = 0;
    const peer = new Peer(
      Object.assign(socket, {
        writableLength: 0,
        write: () => {
          writes++;
          return true;
        },
        destroy: () => socket,
      }) as never,
    );
    let runs = 0;
    peer.handler = async () => {
      runs++;
      return {};
    };
    const send = (id: string) => {
      socket.emit(
        "data",
        Buffer.from(
          `${JSON.stringify({
            version: 1,
            requestId: id,
            generation: 0,
            epoch: "epoch",
            type: "event",
            payload: { event: "resize" },
          })}\n`,
        ),
      );
    };
    for (let i = 0; i < 1100; i++) {
      send(`id-${i}`);
      await new Promise((resolve) => setImmediate(resolve));
    }
    assert.equal(peer.closed, false);
    assert.equal(runs, 1100);
    const before = runs;
    send("id-1099");
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(runs, before);
    assert.equal(peer.closed, false);
    assert.ok(writes > 0);
  });
});

describe("config", () => {
  it("names ui when an unknown ui field is rejected", () => {
    assert.throws(
      () => validateConfig({ ui: { foo: true } }),
      /allowed: enabled, motion, glyphs, theme/,
    );
  });
  it("names ui in the top-level unknown-field message", () => {
    assert.throws(() => validateConfig({ nope: 1 }), /ui/);
  });
});

describe("chips", () => {
  it("styles each chip by role", () => {
    const line = styledChipLine(
      [
        { text: "needs you", role: "accent" },
        { text: "claude", role: "muted" },
      ],
      80,
      (role, text) => `[${role}]${text}`,
    );
    assert.match(line, /\[accent\]needs you/);
    assert.match(line, /\[muted\]claude/);
  });
  it("ascii gauge avoids block glyphs", () => {
    const chip = contextGauge(40, 10, true);
    assert.ok(chip);
    assert.equal(chip.text.includes("▮"), false);
    assert.match(chip.text, /#/);
  });
});

describe("runs", () => {
  it("closes one summary after several tool batches", () => {
    let run = runStart(initialRun(), 0);
    run = runTools(run, 2, 0, false);
    run = runTools(run, 3, 1, false);
    run = runPath(run, toolWritePath("write", { path: "src/a.ts" }));
    const closed = runClose(run, 38000);
    assert.equal(closed.summary?.tools, 5);
    assert.equal(closed.summary?.failed, 1);
    assert.deepEqual(closed.summary?.toolPaths, ["src/a.ts"]);
    assert.equal(closed.state.active, false);
  });
  it("does not close when no run started", () => {
    assert.equal(runClose(initialRun(), 10).summary, null);
  });
});

describe("changes", () => {
  it("parses numstat and labels worktree separately from tool paths", () => {
    const stat = parseNumstat("1\t2\ta.ts\n-\t3\tb.bin\n");
    assert.deepEqual(stat, { files: 2, plus: 1, minus: 5 });
    assert.equal(
      formatChangeSummary(2, stat),
      "tools 2 files · worktree 2 files +1 -5",
    );
  });
});

describe("telemetry gate", () => {
  it("sends waiting immediately and coalesces streaming", () => {
    assert.deepEqual(planReport("", "waiting|0|0|-|confirm|-", false), {
      sendNow: true,
      armTimer: false,
    });
    assert.deepEqual(
      planReport("streaming|1|0|1|-|10", "streaming|1|0|1|-|10", false),
      {
        sendNow: false,
        armTimer: false,
      },
    );
    assert.equal(planReport("", "tooling|1|0|1|-|10", false).armTimer, true);
    assert.equal(planReport("", "tooling|2|0|1|-|10", true).armTimer, false);
    let pending = false;
    let sends = 0;
    const line = "streaming|1|0|1|-|10";
    for (let i = 0; i < 50; i++) {
      const plan = planReport("", line, pending);
      if (plan.sendNow) sends++;
      if (plan.armTimer) pending = true;
    }
    assert.equal(sends, 0);
    assert.equal(pending, true);
    assert.equal(planReport("", "idle|1|0|1|-|10", pending).sendNow, true);
  });
});

describe("recovery copy", () => {
  it("names the next action and omits environment values", () => {
    const home = process.env.HOME ?? "unset-home";
    const samples: Array<[string, RegExp]> = [
      ["LAYOUT", /Previous view kept\. Resize or prefix Tab/],
      ["DISCONNECTED", /Prefix still works\. --resume if it persists/],
      ["AGENT", /Prefix r after confirmation/],
      ["EDITOR", /\/ide starts a new editor/],
      ["EDITOR", /Unsaved buffers are not restored/],
      ["UI", /Stock Pi\. Prefix unaffected/],
      ["THEME", /Session continues/],
      ["NODE", /Node >=22\.19\.0 is required/],
      ["COMPATIBILITY", /tmux >=3\.5 is required/],
    ];
    for (const [code, pattern] of samples) {
      const text = userFacing(new PineError(code, `secret ${home}`));
      assert.match(text, pattern);
      assert.equal(text.includes(home), false);
      assert.equal(text.includes("process.env"), false);
      assert.equal(recoveryCopy(code), text);
    }
  });
});

describe("theme auto", () => {
  it("replaces only Pi built-in defaults", () => {
    assert.equal(autoPinevimTheme("dark"), "pinevim-dark");
    assert.equal(autoPinevimTheme("light"), "pinevim-light");
    assert.equal(autoPinevimTheme("my-theme"), null);
    assert.equal(autoPinevimTheme("pinevim-forest"), null);
  });
});

describe("review", () => {
  it("lists ledger paths and does not invent an edit action", () => {
    assert.deepEqual(reviewOptions(["src/a.ts"]), ["src/a.ts"]);
    assert.match(reviewOptions([])[0]!, /No file changes recorded/);
    assert.equal(
      reviewOptions(["src/a.ts"]).join(" ").includes(":edit"),
      false,
    );
  });
});

describe("skills", () => {
  it("drafts instructions only and refuses a bad name", async () => {
    const draft = draftFromTools(["bash", "bash", "read"]);
    assert.ok(draft);
    assert.equal(draft.status, "proposal");
    assert.equal(validateSkill(draft), null);
    assert.equal(draft.body.includes("#!"), false);
    const dir = await mkdtemp(join(tmpdir(), "pv-skills-"));
    try {
      await saveProposal(draft, dir);
      const listed = await listSkills(dir);
      assert.equal(listed.length, 1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
