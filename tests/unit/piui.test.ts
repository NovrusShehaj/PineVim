import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ASCII,
  UNICODE,
  fit,
  glyphs,
  WORK_FRAMES_ASCII,
  WORK_FRAMES_UNICODE,
} from "../../src/piui/glyphs.js";
import {
  contextGauge,
  chipLine,
  lifecycleChip,
  modeChip,
  modelChip,
  queueChip,
  thinkingChip,
} from "../../src/piui/chips.js";
import {
  initialLifecycle,
  lifecycle,
  LIFECYCLES,
  parseTelemetryLine,
  telemetryLine,
  contextPercent,
  type LifecycleState,
} from "../../src/piui/lifecycle.js";
import {
  ideArgumentCompletions,
  pinevimArgumentCompletions,
} from "../../src/piui/completions.js";
import { treeLines, titleBrand } from "../../src/piui/logo.js";
import { headerFactory } from "../../src/piui/components/header.js";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import {
  PINEVIM_THEMES,
  isPinevimThemeName,
  preferredThemeName,
  themePaths,
  applyTheme,
} from "../../src/piui/theme.js";
import {
  renderTurnSummaryLine,
  formatDuration,
  TURN_SUMMARY_TYPE,
} from "../../src/piui/renderers/turnSummary.js";
import { readdirSync, readFileSync } from "node:fs";

describe("glyphs", () => {
  it("every unicode glyph has an ascii fallback with the same key", () => {
    for (const key of Object.keys(UNICODE) as (keyof typeof UNICODE)[]) {
      assert.ok(ASCII[key], `missing ascii fallback for ${key}`);
      assert.ok(UNICODE[key].length > 0);
    }
  });
  it("no zero-width characters are used", () => {
    const all = Object.values(UNICODE).join("") + Object.values(ASCII).join("");
    for (const ch of all) {
      const cp = ch.codePointAt(0)!;
      assert.notEqual(cp, 0x200b, "zero-width space found");
      assert.notEqual(cp, 0xfeff, "BOM/zero-width no-break found");
    }
  });
  it("glyphs() returns the requested vocabulary", () => {
    assert.equal(glyphs("ascii").user, ASCII.user);
    assert.equal(glyphs("unicode").user, UNICODE.user);
  });
  it("working frames are static-capable and non-empty", () => {
    assert.ok(WORK_FRAMES_UNICODE.length >= 1);
    assert.ok(WORK_FRAMES_ASCII.length >= 1);
  });
  it("fit truncates with ellipsis and never splits surrogate pairs", () => {
    assert.equal(fit("hello", 4).length, 4);
    assert.equal(fit("hello", 10), "hello");
    assert.equal(fit("", 3), "");
    assert.equal(fit("abc", 0), "");
    // surrogate pair: emoji is one code point
    assert.equal([...fit("a😀b", 2)].length, 2);
  });
});

describe("chips", () => {
  const g = glyphs("unicode");
  it("mode chip labels focus when present", () => {
    assert.equal(modeChip("CHAT").text, "CHAT");
    assert.equal(modeChip("IDE", "editor").text, "IDE editor");
  });
  it("lifecycle chip maps states to roles", () => {
    const idle = lifecycleChip({ ...initialLifecycle() }, g);
    assert.equal(idle.role, "success");
    const waiting = lifecycleChip(
      {
        ...initialLifecycle(),
        lifecycle: "waiting",
        prompt: { kind: "confirm" },
      },
      g,
    );
    assert.equal(waiting.role, "accent");
    const error = lifecycleChip(
      { ...initialLifecycle(), lifecycle: "error" },
      g,
    );
    assert.equal(error.role, "error");
  });
  it("context gauge hides when unknown and colors by pressure", () => {
    assert.equal(contextGauge(null), null);
    assert.equal(contextGauge(50)?.role, "muted");
    assert.equal(contextGauge(80)?.role, "warning");
    assert.equal(contextGauge(95)?.role, "error");
    assert.match(contextGauge(40)?.text ?? "", /40%/);
  });
  it("queue chip appears only when messages are queued", () => {
    assert.equal(queueChip(0, g), null);
    assert.match(queueChip(2, g)?.text ?? "", /2 queued/);
  });
  it("model and thinking chips omit empty values", () => {
    assert.equal(modelChip(null), null);
    assert.equal(modelChip(undefined), null);
    assert.equal(thinkingChip(null), null);
    assert.equal(thinkingChip("medium")?.text, "think med");
  });
  it("chipLine drops tail chips before truncating", () => {
    const line = chipLine(
      [
        { text: "aaa", role: "muted" },
        { text: "bbb", role: "muted" },
        { text: "ccc", role: "muted" },
      ],
      10,
    );
    assert.ok([...line].length <= 10);
    assert.match(line, /aaa/);
    assert.doesNotMatch(line, /ccc/);
  });
});

describe("lifecycle", () => {
  const start = (over: Partial<LifecycleState> = {}): LifecycleState => ({
    ...initialLifecycle(),
    ...over,
  });
  it("covers all documented states", () => {
    assert.deepEqual(
      [...LIFECYCLES].sort(),
      [
        "compacting",
        "error",
        "idle",
        "interrupted",
        "settling",
        "streaming",
        "thinking",
        "tooling",
        "waiting",
      ].sort(),
    );
  });
  it("turn_start resets per-turn counters and clears error/interrupted", () => {
    const s = lifecycle.turnStart(
      start({ lifecycle: "error", toolsRun: 4, toolsFailed: 2, aborted: true }),
      3,
    );
    assert.equal(s.lifecycle, "streaming");
    assert.equal(s.toolsRun, 0);
    assert.equal(s.toolsFailed, 0);
    assert.equal(s.turnIndex, 3);
    assert.equal(s.aborted, false);
  });
  it("message_update distinguishes thinking from streaming", () => {
    const thinking = lifecycle.messageUpdate(start(), {
      type: "message_update",
      message: {
        role: "assistant",
        content: [{ type: "thinking", thinking: "..." }],
      },
      assistantMessageEvent: {},
    } as never);
    assert.equal(thinking.lifecycle, "thinking");
    const streaming = lifecycle.messageUpdate(start(), {
      type: "message_update",
      message: { role: "assistant", content: [{ type: "text", text: "hi" }] },
      assistantMessageEvent: {},
    } as never);
    assert.equal(streaming.lifecycle, "streaming");
  });
  it("waiting overrides tooling and survives tool events", () => {
    let s = lifecycle.toolStart(start({ lifecycle: "streaming" }), {
      type: "tool_execution_start",
      toolCallId: "1",
      toolName: "bash",
      args: {},
    });
    assert.equal(s.lifecycle, "tooling");
    s = lifecycle.waiting(s, {
      type: "ui_prompt_start",
      reason: "ui_prompt",
      kind: "confirm",
    });
    assert.equal(s.lifecycle, "waiting");
    s = lifecycle.toolEnd(s, {
      type: "tool_execution_end",
      toolCallId: "1",
      toolName: "bash",
      result: {},
      isError: false,
    });
    assert.equal(s.lifecycle, "waiting", "waiting must survive tool end");
  });
  it("prompt end returns to tooling", () => {
    let s = lifecycle.waiting(start(), {
      type: "ui_prompt_start",
      reason: "ui_prompt",
      kind: "input",
    });
    s = lifecycle.promptEnd(s, {
      type: "ui_prompt_end",
      reason: "ui_prompt",
      kind: "input",
    });
    assert.equal(s.lifecycle, "tooling");
    assert.equal(s.prompt, null);
  });
  it("tool failures are counted", () => {
    let s = lifecycle.toolStart(start(), {
      type: "tool_execution_start",
      toolCallId: "1",
      toolName: "bash",
      args: {},
    });
    s = lifecycle.toolEnd(s, {
      type: "tool_execution_end",
      toolCallId: "1",
      toolName: "bash",
      result: {},
      isError: true,
    });
    assert.equal(s.toolsFailed, 1);
  });
  it("settled maps turn error to error lifecycle, else idle", () => {
    const errored = lifecycle.settled(start({ turnError: true }));
    assert.equal(errored.lifecycle, "error");
    const ok = lifecycle.settled(start({ lifecycle: "settling" }));
    assert.equal(ok.lifecycle, "idle");
  });
  it("aborted keeps counts and flags interruption", () => {
    const s = lifecycle.aborted(start({ toolsRun: 3, toolsFailed: 1 }));
    assert.equal(s.lifecycle, "interrupted");
    assert.equal(s.aborted, true);
    assert.equal(s.toolsRun, 3);
  });
  it("compacting overrides and clears after settle", () => {
    let s = lifecycle.compacting(start(), {
      type: "session_before_compact",
      preparation: {} as never,
      branchEntries: [],
      reason: "manual",
      willRetry: false,
      signal: new AbortController().signal,
    });
    assert.equal(s.lifecycle, "compacting");
    s = lifecycle.settled(s);
    assert.equal(s.lifecycle, "idle");
  });
  it("telemetry line round-trips", () => {
    const s = start({
      lifecycle: "tooling",
      toolsRun: 2,
      toolsFailed: 1,
      turnIndex: 4,
    });
    const line = telemetryLine(s, 42.4);
    assert.equal(line, "tooling|2|1|4|-|42");
    const parsed = parseTelemetryLine(line);
    assert.equal(parsed?.lifecycle, "tooling");
    assert.equal(parsed?.toolsRun, 2);
    assert.equal(parsed?.toolsFailed, 1);
    assert.equal(parsed?.turnIndex, 4);
    assert.equal(parsed?.ctxPercent, 42);
  });
  it("parse rejects malformed telemetry", () => {
    assert.equal(parseTelemetryLine("bogus"), null);
    assert.equal(parseTelemetryLine("tooling|x|1|1|-|5"), null);
    assert.equal(parseTelemetryLine("hax|1|1|1|-|5"), null);
    // Out-of-range ctx parses as a number but renders clamped by the gauge;
    // parse is permissive, rendering is strict.
    assert.equal(parseTelemetryLine("idle|1|1|-|-|999")?.ctxPercent, 999);
  });
  it("contextPercent clamps to 0-100", () => {
    const ctx = {
      getContextUsage: () => ({ tokens: 1, contextWindow: 10, percent: 140 }),
    };
    assert.equal(contextPercent(ctx as never), 100);
    const none = { getContextUsage: () => undefined };
    assert.equal(contextPercent(none as never), null);
  });
});

describe("turn summary", () => {
  const g = glyphs("unicode");
  it("formats durations", () => {
    assert.equal(formatDuration(null), null);
    assert.equal(formatDuration(-1), null);
    assert.equal(formatDuration(3.21), "3.2 s");
    assert.equal(formatDuration(38.4), "38 s");
  });
  it("renders completed turn grammar", () => {
    const line = renderTurnSummaryLine(
      {
        turn: 7,
        seconds: 38.2,
        tools: 5,
        failed: 0,
        interrupted: false,
        ctxPercent: 51,
      },
      g,
      60,
    );
    assert.match(line, /turn 7/);
    assert.match(line, /5 tools/);
    assert.doesNotMatch(line, /failed/);
    assert.match(line, /38 s/);
    assert.match(line, /ctx 51%/);
    assert.ok([...line].length <= 60);
  });
  it("renders interrupted and failed turns distinctly", () => {
    const line = renderTurnSummaryLine(
      {
        turn: 2,
        seconds: 1,
        tools: 3,
        failed: 1,
        interrupted: true,
        ctxPercent: null,
      },
      g,
      60,
    );
    assert.match(line, /interrupted/);
    assert.match(line, /1 failed/);
  });
  it("summary type is namespaced", () => {
    assert.match(TURN_SUMMARY_TYPE, /^pinevim\./);
  });
});

describe("theme assets", () => {
  it("ships all PineVIM theme files at discoverable paths", () => {
    const paths = themePaths();
    assert.equal(paths.length, PINEVIM_THEMES.length);
    for (const [i, name] of PINEVIM_THEMES.entries()) {
      assert.match(paths[i]!, new RegExp(`${name}\\.json$`));
    }
  });
  it("theme JSON documents are complete against Pi's required slots", () => {
    // Pi's ThemeJson schema requires these fg colors; scrollbar*/thinkingMax/search* optional.
    const required = [
      "accent",
      "border",
      "borderAccent",
      "borderMuted",
      "success",
      "error",
      "warning",
      "muted",
      "dim",
      "text",
      "thinkingText",
      "selectedBg",
      "userMessageBg",
      "userMessageText",
      "customMessageBg",
      "customMessageText",
      "customMessageLabel",
      "toolPendingBg",
      "toolSuccessBg",
      "toolErrorBg",
      "toolTitle",
      "toolOutput",
      "mdHeading",
      "mdLink",
      "mdLinkUrl",
      "mdCode",
      "mdCodeBlock",
      "mdCodeBlockBorder",
      "mdQuote",
      "mdQuoteBorder",
      "mdHr",
      "mdListBullet",
      "toolDiffAdded",
      "toolDiffRemoved",
      "toolDiffContext",
      "syntaxComment",
      "syntaxKeyword",
      "syntaxFunction",
      "syntaxVariable",
      "syntaxString",
      "syntaxNumber",
      "syntaxType",
      "syntaxOperator",
      "syntaxPunctuation",
      "thinkingOff",
      "thinkingMinimal",
      "thinkingLow",
      "thinkingMedium",
      "thinkingHigh",
      "thinkingXhigh",
      "bashMode",
    ];
    for (const name of PINEVIM_THEMES) {
      const file = themePaths().find((p) => p.includes(name))!;
      const doc = JSON.parse(readFileSync(file, "utf8")) as {
        name: string;
        colors: Record<string, unknown>;
      };
      assert.equal(doc.name, name);
      for (const key of required) {
        assert.ok(doc.colors[key] !== undefined, `${name} missing ${key}`);
      }
    }
  });

  it("covers the mono theme and the color variants", () => {
    assert.ok(PINEVIM_THEMES.includes("pinevim-mono"));
    assert.ok(PINEVIM_THEMES.includes("pinevim-neon"));
    assert.ok(PINEVIM_THEMES.includes("pinevim-forest"));
    assert.ok(PINEVIM_THEMES.includes("pinevim-snow"));
    assert.ok(isPinevimThemeName("pinevim-mono"));
    assert.ok(isPinevimThemeName("pinevim-neon"));
    assert.ok(isPinevimThemeName("pinevim-forest"));
    assert.ok(isPinevimThemeName("pinevim-snow"));
    assert.ok(!isPinevimThemeName("pinevim-neonx"));
  });

  it("every theme json file on disk is registered", () => {
    // copy-themes copies by extension, so a stray unregistered file would
    // ship to Pi's discovery path without being selectable by name.
    const dir = themePaths()[0]!.replace(/\/[^/]+$/, "");
    const onDisk = readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(/\.json$/, ""));
    assert.deepEqual(onDisk.sort(), [...PINEVIM_THEMES].sort());
  });

  it("auto follows the detected color scheme; explicit names pin it", () => {
    assert.equal(preferredThemeName(undefined, undefined), "pinevim-dark");
    assert.equal(preferredThemeName("auto", "light"), "pinevim-light");
    assert.equal(preferredThemeName("auto", "dark"), "pinevim-dark");
    assert.equal(preferredThemeName("pinevim-mono", "light"), "pinevim-mono");
    assert.equal(preferredThemeName("garbage", "light"), "pinevim-light");
  });

  it("applyTheme passes the instance and never the name", () => {
    const calls: unknown[] = [];
    const ui = {
      theme: { name: "something-else" },
      getTheme: (name: string) =>
        name === "pinevim-dark" ? { name: "pinevim-dark" } : undefined,
      setTheme: (t: unknown) => {
        calls.push(t);
        return { success: true };
      },
    };
    assert.equal(applyTheme(ui as never, "pinevim-dark"), true);
    assert.deepEqual(calls, [{ name: "pinevim-dark" }]);
  });

  it("applyTheme is a no-op when the theme is already active", () => {
    let calls = 0;
    const ui = {
      theme: { name: "pinevim-mono" },
      getTheme: () => undefined,
      setTheme: () => {
        calls++;
        return { success: true };
      },
    };
    assert.equal(applyTheme(ui as never, "pinevim-mono"), true);
    assert.equal(calls, 0);
  });

  it("applyTheme degrades when the theme is unavailable", () => {
    const ui = {
      theme: { name: "other" },
      getTheme: () => undefined,
      setTheme: () => ({ success: false }),
    };
    assert.equal(applyTheme(ui as never, "pinevim-mono"), false);
  });
});

describe("slash completions", () => {
  it("completes pinevim subcommands by prefix", () => {
    // "ide" is itself a complete subcommand of /pinevim — the popup must yield
    // (null) there so Enter submits; while typing "id", all ide entries show.
    assert.deepEqual(
      (pinevimArgumentCompletions("id") ?? []).map((i) => i.value),
      ["ide", "ide open", "ide close"],
    );
    assert.equal(pinevimArgumentCompletions("ide"), null);
    assert.deepEqual(
      (pinevimArgumentCompletions("sta") ?? []).map((i) => i.value),
      ["status"],
    );
    assert.equal(pinevimArgumentCompletions("zzz"), null);
  });

  it("completes ide open/close", () => {
    assert.deepEqual(
      (ideArgumentCompletions("o") ?? []).map((i) => i.value),
      ["open"],
    );
    assert.deepEqual((ideArgumentCompletions("cl") ?? []).map((i) => i.value), [
      "close",
    ]);
    assert.equal(ideArgumentCompletions("zzz"), null);
  });

  it("stays inert on an empty argument so Enter submits", () => {
    // Pi's editor opens its popup on any non-null result and the next Enter
    // then accepts the item instead of submitting — scripted "/ide" + Enter
    // must never be intercepted.
    assert.equal(ideArgumentCompletions(""), null);
    assert.equal(pinevimArgumentCompletions(""), null);
  });

  it("yields once the argument is a complete subcommand", () => {
    // While typing "ope" suggest; once exactly "open" is typed, return null so
    // the popup closes and Enter submits instead of accepting an item.
    assert.ok((ideArgumentCompletions("ope") ?? []).length > 0);
    assert.equal(ideArgumentCompletions("open"), null);
    assert.ok((pinevimArgumentCompletions("sta") ?? []).length > 0);
    assert.equal(pinevimArgumentCompletions("status"), null);
    assert.equal(pinevimArgumentCompletions("ide open"), null);
  });
});

describe("logo", () => {
  it("tree lines are exactly one cell per glyph (no emoji drift)", () => {
    for (const lines of [treeLines("unicode"), treeLines("ascii")]) {
      for (const line of lines) {
        for (const ch of line) {
          if (ch === " ") continue;
          const cp = ch.codePointAt(0)!;
          // All glyphs must live in the BMP and outside the emoji blocks:
          // pi-tui measures emoji at 2 cells while several terminals render
          // them at 1, which would drift the header's right alignment.
          assert.ok(cp < 0x1f000, `glyph U+${cp.toString(16)} may be wide`);
        }
      }
    }
  });
  it("ascii fallback keeps the same two-line shape", () => {
    const [uCrown, uBase] = treeLines("unicode");
    const [aCrown, aBase] = treeLines("ascii");
    assert.equal([...uCrown].length, [...aCrown].length);
    assert.equal([...uBase].length, [...aBase].length);
    assert.match(aCrown, /\^/);
    assert.match(aBase, /\//);
  });
  it("title brand is ascii-safe in ascii mode", () => {
    assert.match(titleBrand("ascii"), /^pinevim$/);
    assert.match(titleBrand("unicode"), /pinevim$/);
  });
});

describe("header", () => {
  const g = glyphs("unicode");
  const make = (width: number, glyphMode: "unicode" | "ascii" = "unicode") => {
    const tui = { requestRender: () => {} } as never;
    const theme = {
      fg: (_role: string, s: string) => s,
      bold: (s: string) => s,
    } as never;
    const info = {
      workspace: "~/proj",
      sessionName: null,
      mode: "CHAT" as const,
      lifecycle: initialLifecycle(),
    };
    return headerFactory(tui, theme, g, info, glyphMode).render(width);
  };

  it("renders the pine logo and wordmark in the wide band", () => {
    const lines = make(100);
    assert.ok(lines.length >= 2, "logo band + identity line expected");
    const bare = lines.map(stripTerminalSequences).join("\n");
    assert.match(bare, /pinevim/);
    assert.match(bare, /▲/);
    assert.match(bare, /\/\|\\/);
    assert.match(bare, /CHAT/);
  });

  it("every header line fits the requested width in both bands", () => {
    for (const width of [60, 79, 80, 100, 160]) {
      const lines = make(width);
      assert.ok(lines.length >= 1);
      for (const line of lines) {
        assert.ok(
          [...stripTerminalSequences(line)].length <= width,
          `line exceeds ${width}: ${line}`,
        );
      }
    }
  });

  it("suppresses below 60 columns", () => {
    assert.deepEqual(make(59), []);
  });

  it("ascii glyph mode swaps the crown, keeps alignment", () => {
    const lines = make(100, "ascii");
    const bare = lines.map(stripTerminalSequences).join("\n");
    assert.match(bare, /\^/);
    assert.doesNotMatch(bare, /▲/);
  });
});
