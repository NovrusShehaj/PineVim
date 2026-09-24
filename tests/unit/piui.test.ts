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
import {
  PINE_CROWN_LINES,
  PINE_TRUNK_FACTOR_OVERRIDES,
  PINE_TREE,
  PINE_TREE_WIDTH,
  shadeFgAnsi,
  titleBrand,
  treeLines,
  trunkFactorFor,
} from "../../src/piui/logo.js";
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
import {
  toolStateGlyph,
  toolStateRole,
  formatDiffstat,
  extractToolArgs,
  formatToolCardLine,
  ToolCardComponent,
  type ToolCardInfo,
} from "../../src/piui/renderers/cards.js";

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
    assert.equal(s.lifecycle, "idle");
    assert.equal(s.prompt, null);
  });
  it("prompt end restores tooling when the prompt interrupted tools", () => {
    let s = lifecycle.toolStart(start(), {
      type: "tool_execution_start",
      toolCallId: "1",
      toolName: "bash",
      args: {},
    });
    s = lifecycle.waiting(s, {
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
  });
  it("text deltas stay streaming even if a thinking block exists", () => {
    const s = lifecycle.messageUpdate(start(), {
      type: "message_update",
      message: {
        role: "assistant",
        content: [{ type: "thinking", thinking: "..." }],
      },
      assistantMessageEvent: { type: "text_delta" },
    } as never);
    assert.equal(s.lifecycle, "streaming");
  });
  it("compact done restores idle instead of forcing streaming", () => {
    let s = lifecycle.compacting(start(), {
      type: "session_before_compact",
      preparation: {} as never,
      branchEntries: [],
      reason: "manual",
      willRetry: false,
      signal: new AbortController().signal,
    });
    s = lifecycle.compactDone(s);
    assert.equal(s.lifecycle, "idle");
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
    assert.deepEqual(
      (ideArgumentCompletions("cl") ?? []).map((i) => i.value),
      ["close"],
    );
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
  it("shadeFgAnsi scales truecolor RGB and clamps", () => {
    assert.equal(
      shadeFgAnsi("\x1b[38;2;100;200;60m", 0.5),
      "\x1b[38;2;50;100;30m",
    );
    // Rounding + clamp at both ends.
    assert.equal(
      shadeFgAnsi("\x1b[38;2;61;255;160m", 0.68),
      "\x1b[38;2;41;173;109m",
    );
    assert.equal(
      shadeFgAnsi("\x1b[38;2;10;20;30m", 50),
      "\x1b[38;2;255;255;255m",
    );
    assert.equal(shadeFgAnsi("\x1b[38;2;10;20;30m", 0), "\x1b[38;2;0;0;0m");
  });
  it("shadeFgAnsi falls back to null for non-truecolor sequences", () => {
    assert.equal(shadeFgAnsi("\x1b[38;5;196m", 0.5), null);
    assert.equal(shadeFgAnsi("\x1b[31m", 0.5), null);
    assert.equal(shadeFgAnsi("not-ansi", 0.5), null);
    assert.equal(shadeFgAnsi("\x1b[38;2;1;2m", 0.5), null);
  });
  it("the full pine is pure ASCII — one cell per glyph under every width model", () => {
    // pi-tui measures emoji and some symbols at 2 cells while several
    // terminals render them at 1; ASCII keeps the header arithmetic exact.
    for (const line of PINE_TREE) {
      assert.match(
        line,
        /^[ -~]*$/,
        `non-ASCII glyph in ${JSON.stringify(line)}`,
      );
    }
  });
  it("the full pine fits its declared width and line count", () => {
    assert.equal(PINE_TREE.length, 11);
    for (const line of PINE_TREE) {
      assert.ok(line.length <= PINE_TREE_WIDTH, `too wide: ${line}`);
    }
    assert.equal(
      Math.max(...PINE_TREE.map((l) => l.length)),
      PINE_TREE_WIDTH,
      "PINE_TREE_WIDTH must equal the widest line",
    );
  });
  it("compact mark: crown and base share the same cell width", () => {
    const [crown, base] = treeLines();
    assert.equal(crown.length, base.length);
    assert.ok(crown.includes("/"));
    assert.ok(base.includes("|"));
  });
  it("trunkFactorFor: default for unknown/unnamed themes, per-theme overrides", () => {
    assert.equal(trunkFactorFor(undefined), trunkFactorFor("pinevim-dark"));
    assert.equal(trunkFactorFor("not-a-theme"), trunkFactorFor("pinevim-dark"));
    assert.equal(
      trunkFactorFor("pinevim-neon"),
      trunkFactorFor("pinevim-dark"),
    );
    // Light-background themes lift the trunk (> 1) instead of sinking it.
    assert.ok(trunkFactorFor("pinevim-snow") > 1, "snow lifts");
    assert.ok(trunkFactorFor("pinevim-light") > 1, "light lifts");
  });
  it("every trunk-factor override key is a shipped PineVIM theme", () => {
    for (const name of Object.keys(PINE_TRUNK_FACTOR_OVERRIDES)) {
      assert.ok(
        isPinevimThemeName(name),
        `override key ${name} is not a pinevim theme`,
      );
    }
  });
  it("shadeFgAnsi clamps channels at 255 for factors above 1", () => {
    assert.equal(
      shadeFgAnsi("\x1b[38;2;200;200;200m", 2),
      "\x1b[38;2;255;255;255m",
    );
    assert.equal(
      shadeFgAnsi("\x1b[38;2;12;143;67m", 1.35),
      "\x1b[38;2;16;193;90m",
    );
  });
  it("title brand is ascii-safe", () => {
    assert.match(titleBrand(), /^pinevim$/);
  });
});

describe("header", () => {
  const g = glyphs("unicode");
  const idle: LifecycleState = initialLifecycle();
  const active: LifecycleState = { ...idle, lifecycle: "streaming" };
  // Realistic accent styling: Theme.fg wraps text in the resolved SGR code
  // (a pass-through stub would hide the canopy's ANSI from assertions).
  const ACCENT = "\x1b[38;2;61;255;160m";
  const makeWith = (
    width: number,
    lifecycle: LifecycleState,
    themeName = "pinevim-dark",
  ) => {
    const tui = { requestRender: () => {} } as never;
    const theme = {
      name: themeName,
      fg: (role: string, s: string) =>
        role === "accent" ? `${ACCENT}${s}\x1b[0m` : s,
      bold: (s: string) => s,
      getFgAnsi: (_role: string) => ACCENT,
    } as never;
    const info = {
      workspace: "~/proj",
      sessionName: null,
      mode: "CHAT" as const,
      lifecycle,
    };
    return headerFactory(tui, theme, g, info).render(width);
  };

  it("two-tone pine: canopy in accent, trunk in the darker same-hue shade", () => {
    const lines = makeWith(120, idle);
    assert.equal(lines.length, 11);
    for (const [idx, line] of lines.entries()) {
      if (idx < PINE_CROWN_LINES) {
        assert.ok(
          line.includes("\x1b[38;2;61;255;160m"),
          `canopy line ${idx} not in accent`,
        );
      } else {
        assert.ok(
          line.includes("\x1b[38;2;37;153;96m"),
          `trunk line ${idx} not in shaded accent`,
        );
      }
    }
  });

  it("two-tone degrades to single-tone without truecolor", () => {
    const tui = { requestRender: () => {} } as never;
    const theme = {
      fg: (_role: string, s: string) => s,
      bold: (s: string) => s,
      getFgAnsi: (_role: string) => "\x1b[38;5;196m",
    } as never;
    const info = {
      workspace: "~/proj",
      sessionName: null,
      mode: "CHAT" as const,
      lifecycle: idle,
    };
    const lines = headerFactory(tui, theme, g, info).render(120);
    assert.equal(lines.length, 11);
    for (const line of lines) {
      assert.ok(
        line.includes("\x1b[38;2;61;255;160m") === false,
        "unexpected truecolor",
      );
      assert.ok(!line.includes("38;5;"), "shade must not leak 256-color codes");
    }
  });
  it("light themes lift the trunk above the accent instead of sinking it", () => {
    // Same accent RGB as the dark-theme test, but the theme is snow: the
    // trunk factor (> 1) must brighten, not darken.
    const lines = makeWith(120, idle, "pinevim-snow");
    assert.equal(lines.length, 11);
    const canopy = "38;2;61;255;160";
    const lifted = "38;2;82;255;216"; // (61,255,160) * 1.35, clamped
    for (const [idx, line] of lines.entries()) {
      if (idx < PINE_CROWN_LINES) {
        assert.ok(line.includes(canopy), `canopy line ${idx} not in accent`);
      } else {
        assert.ok(line.includes(lifted), `trunk line ${idx} not lifted`);
        assert.ok(
          !line.includes("38;2;37;153;96m"),
          "trunk must not use the dark-theme shade",
        );
      }
    }
  });
  const bare = (lines: string[]): string =>
    lines.map(stripTerminalSequences).join("\n");

  it("full pine is permanent at >= 100 columns (even after turns)", () => {
    const splash = makeWith(120, idle);
    assert.equal(splash.length, 11, "full pine line count");
    assert.match(bare(splash), /\/\|\|\\/);
    // After activity: still the full tree, with side info.
    const after = makeWith(120, active);
    assert.equal(after.length, 11);
    assert.match(bare(after), /CHAT/);
    assert.match(bare(after), /pinevim/);
    assert.match(bare(after), /~\/proj/);
  });

  it("60-99 columns: splash pine greets, then collapses on first active turn", () => {
    const splash = makeWith(90, idle);
    assert.equal(splash.length, 11, "splash shows the greeting pine");
    const collapsed = makeWith(90, active);
    assert.ok(collapsed.length < 11, "collapsed after activity");
    assert.match(bare(collapsed), /pinevim/);
    assert.match(bare(collapsed), /CHAT/);
  });

  it("collapsed compact mark: two lines at 80-99, one line at 60-79", () => {
    const wide = makeWith(85, active);
    assert.equal(wide.length, 2);
    assert.match(bare(wide), /\/\|\|\\/);
    const narrow = makeWith(70, active);
    assert.equal(narrow.length, 1);
    assert.match(bare(narrow), /\//);
  });

  it("every header line fits the requested width in all bands and states", () => {
    for (const width of [60, 79, 80, 99, 100, 120, 200]) {
      for (const lc of [idle, active]) {
        const lines = makeWith(width, lc);
        assert.ok(lines.length >= 1, `no lines at ${width}`);
        for (const line of lines) {
          assert.ok(
            [...stripTerminalSequences(line)].length <= width,
            `line exceeds ${width}: ${stripTerminalSequences(line)}`,
          );
        }
      }
    }
  });

  it("suppresses below 60 columns", () => {
    assert.deepEqual(makeWith(59, idle), []);
  });
});

describe("cards", () => {
  const u = UNICODE;
  const a = ASCII;

  it("returns correct glyph for each state in unicode and ascii", () => {
    assert.equal(toolStateGlyph("running", u), "●");
    assert.equal(toolStateGlyph("success", u), "✓");
    assert.equal(toolStateGlyph("warning", u), "▲");
    assert.equal(toolStateGlyph("failure", u), "✗");
    assert.equal(toolStateGlyph("interrupted", u), "⏸");
    assert.equal(toolStateGlyph("waiting", u), "?");

    assert.equal(toolStateGlyph("running", a), "*");
    assert.equal(toolStateGlyph("success", a), "+");
    assert.equal(toolStateGlyph("warning", a), "!");
    assert.equal(toolStateGlyph("failure", a), "x");
    assert.equal(toolStateGlyph("interrupted", a), "=");
    assert.equal(toolStateGlyph("waiting", a), "?");
  });

  it("returns correct theme role for each state", () => {
    assert.equal(toolStateRole("running"), "text");
    assert.equal(toolStateRole("success"), "success");
    assert.equal(toolStateRole("warning"), "warning");
    assert.equal(toolStateRole("failure"), "error");
    assert.equal(toolStateRole("interrupted"), "warning");
    assert.equal(toolStateRole("waiting"), "accent");
  });

  it("formats diffstats in unicode and ascii", () => {
    assert.equal(formatDiffstat(12, 3, false), "+12 −3");
    assert.equal(formatDiffstat(12, 3, true), "+12 -3");
  });

  it("extracts primary and secondary args across tool types", () => {
    assert.deepEqual(
      extractToolArgs("read", { path: "src/foo.ts", offset: 10, limit: 20 }),
      {
        primary: "src/foo.ts",
        secondary: "lines 10–29",
      },
    );
    assert.deepEqual(
      extractToolArgs("read", { path: "src/foo.ts", offset: 5 }),
      {
        primary: "src/foo.ts",
        secondary: "from line 5",
      },
    );
    assert.deepEqual(extractToolArgs("edit", { path: "src/foo.ts" }), {
      primary: "src/foo.ts",
    });
    assert.deepEqual(
      extractToolArgs("write", { path: "hello.txt", content: "hello world" }),
      {
        primary: "hello.txt",
        secondary: "11 B",
      },
    );
    assert.deepEqual(
      extractToolArgs("bash", { command: "npm   test\n--verbose" }),
      {
        primary: "npm test --verbose",
      },
    );
    assert.deepEqual(
      extractToolArgs("grep", { pattern: "todo", path: "src" }),
      {
        primary: '"todo" src',
      },
    );
    assert.deepEqual(
      extractToolArgs("find", { query: "auth check", path: "src" }),
      {
        primary: '"auth check" src',
      },
    );
    assert.deepEqual(extractToolArgs("ls", { path: "src/core" }), {
      primary: "src/core",
    });
    assert.deepEqual(extractToolArgs("custom", { target: "my-target" }), {
      primary: "my-target",
    });
  });

  it("formats tool card line responsively across width bands", () => {
    const info: ToolCardInfo = {
      tool: "bash",
      state: "success",
      primaryArg: "npm test",
      secondaryArg: "cached",
      counts: "2 runs",
      durationSeconds: 1.5,
    };

    // >= 101 cols
    const w110 = formatToolCardLine(info, u, 110);
    assert.match(w110, /✓ bash npm test/);
    assert.match(w110, /cached/);
    assert.match(w110, /2 runs/);
    assert.match(w110, /1\.5 s/);

    // 80-100 cols (no secondaryArg)
    const w90 = formatToolCardLine(info, u, 90);
    assert.match(w90, /✓ bash npm test/);
    assert.doesNotMatch(w90, /cached/);
    assert.match(w90, /2 runs/);
    assert.match(w90, /1\.5 s/);

    // 60-79 cols (no secondaryArg, no counts)
    const w70 = formatToolCardLine(info, u, 70);
    assert.match(w70, /✓ bash npm test/);
    assert.doesNotMatch(w70, /2 runs/);
    assert.match(w70, /1\.5 s/);

    // < 60 cols (name + glyph only)
    const w50 = formatToolCardLine(info, u, 50);
    assert.equal(w50, "✓ bash");
  });

  it("ToolCardComponent renders collapsed and expanded states", () => {
    const tui = { requestRender: () => {} } as never;
    const theme = { fg: (_role: string, s: string) => s } as never;
    const info: ToolCardInfo = {
      tool: "read",
      state: "success",
      primaryArg: "src/main.ts",
      previewLines: ["line 1", "line 2"],
    };

    const card = new ToolCardComponent(tui, theme, u, info);
    const collapsed = card.render(100).join("\n");
    assert.match(collapsed, /✓ read src\/main\.ts/);
    assert.doesNotMatch(collapsed, /line 1/);

    card.setExpanded(true);
    const expanded = card.render(100).join("\n");
    assert.match(expanded, /✓ read src\/main\.ts/);
    assert.match(expanded, /│\s+line 1/);
    assert.match(expanded, /│\s+line 2/);
  });
});
