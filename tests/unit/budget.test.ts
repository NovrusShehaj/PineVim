import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BudgetGuard,
  budgetDisabled,
  BUDGET_DISABLED,
  stopMessage,
  usd,
  validateBudgetInput,
  warnMessage,
  type BudgetConfig,
} from "../../src/piui/budget.js";
import { initialBudget, addTurnUsage } from "../../src/piui/runs.js";
import { budgetFromEnv } from "../../src/piui/tier2.js";
import { validateConfig } from "../../src/config.js";
import { PineError } from "../../src/diagnostics.js";

const configWith = (partial: Partial<BudgetConfig>): BudgetConfig =>
  ({ ...BUDGET_DISABLED, ...partial }) as BudgetConfig;

describe("ui.budget config validation (Tier 2 #6)", () => {
  it("accepts a well-formed budget and defaults to disabled without one", () => {
    const withBudget = validateConfig({
      ui: { budget: { warnAt: 1, stopAt: 2 } },
    });
    assert.deepEqual(withBudget.ui.budget, { warnAt: 1, stopAt: 2 });
    const without = validateConfig({});
    assert.equal(without.ui.budget, undefined, "absent budget stays disabled");
    const empty = validateConfig({ ui: { budget: {} } });
    assert.equal(empty.ui.budget, undefined, "empty budget stays disabled");
  });

  it("rejects malformed values with CONFIG errors", () => {
    const cases: unknown[] = [
      { ui: { budget: "5" } },
      { ui: { budget: [] } },
      { ui: { budget: { warnAt: 0 } } },
      { ui: { budget: { stopAt: -1 } } },
      { ui: { budget: { warnAt: Number.NaN } } },
      { ui: { budget: { warnAt: Infinity } } },
      { ui: { budget: { warnAt: "2" } } },
      { ui: { budget: { unknown: 1 } } },
      { ui: { budget: { warnAt: 5, stopAt: 2 } } }, // warn > stop
    ];
    for (const input of cases)
      assert.throws(
        () => validateConfig(input),
        (e: unknown) => e instanceof PineError && e.code === "CONFIG",
        `expected CONFIG failure for ${JSON.stringify(input)}`,
      );
  });

  it("accepts warnAt-only, stopAt-only, and equal thresholds", () => {
    assert.doesNotThrow(() =>
      validateConfig({ ui: { budget: { warnAt: 2 } } }),
    );
    assert.doesNotThrow(() =>
      validateConfig({ ui: { budget: { stopAt: 2 } } }),
    );
    // warnAt == stopAt: warns at the same boundary that stops; legal.
    assert.doesNotThrow(() =>
      validateConfig({ ui: { budget: { warnAt: 2, stopAt: 2 } } }),
    );
  });

  it("validates the raw input through one shared rule set", () => {
    const fail = (message: string): never => {
      throw new PineError("CONFIG", message);
    };
    assert.throws(() => validateBudgetInput({ warnAt: 0 }, fail), PineError);
    assert.deepEqual(validateBudgetInput(undefined, fail), {});
    assert.deepEqual(validateBudgetInput({ warnAt: 1.5 }, fail), {
      warnAt: 1.5,
    });
  });
});

describe("budget guard decisions", () => {
  it("warns exactly once at the threshold and never again", () => {
    const guard = new BudgetGuard(configWith({ warnAt: 1, stopAt: 2 }));
    let budget = initialBudget();
    assert.equal(guard.evaluate(budget).kind, "none");
    budget = addTurnUsage(budget, { totalTokens: 10, cost: { total: 0.5 } });
    assert.equal(guard.evaluate(budget).kind, "none");
    budget = addTurnUsage(budget, { totalTokens: 10, cost: { total: 0.5 } });
    assert.equal(guard.evaluate(budget).kind, "warn", "crossing warns");
    assert.equal(guard.evaluate(budget).kind, "none", "no repeat spam");
    budget = addTurnUsage(budget, { totalTokens: 10, cost: { total: 0.4 } });
    assert.equal(guard.evaluate(budget).kind, "none", "still latched");
  });

  it("stops at the ceiling and keeps the stop decision latched", () => {
    const guard = new BudgetGuard(configWith({ warnAt: 1, stopAt: 2 }));
    let budget = initialBudget();
    budget = addTurnUsage(budget, { totalTokens: 1, cost: { total: 1.99 } });
    assert.equal(guard.evaluate(budget).kind, "warn");
    budget = addTurnUsage(budget, { totalTokens: 1, cost: { total: 0.01 } });
    assert.equal(guard.evaluate(budget).kind, "stop", "costTotal >= stopAt");
    assert.equal(guard.evaluate(budget).kind, "stop", "stays stopped");
    assert.equal(guard.shouldBlockStart(budget), true);
  });

  it("never blocks when the budget is disabled or unset", () => {
    for (const cfg of [
      BUDGET_DISABLED,
      configWith({ warnAt: 1, stopAt: null }),
    ]) {
      const guard = new BudgetGuard(cfg);
      const budget = addTurnUsage(initialBudget(), {
        totalTokens: 1,
        cost: { total: 1e5 },
      });
      assert.equal(
        guard.evaluate(budget).kind,
        cfg.stopAt === null && cfg.warnAt !== null ? "warn" : "none",
      );
      assert.equal(guard.shouldBlockStart(budget), false);
    }
    assert.equal(budgetDisabled(BUDGET_DISABLED), true);
    assert.equal(budgetDisabled(configWith({ stopAt: 3 })), false);
  });

  it("blocks a session that starts already over the ceiling", () => {
    const guard = new BudgetGuard(configWith({ warnAt: 1, stopAt: 2 }));
    // Session resumed/spent elsewhere: first evaluation is already over.
    const over = addTurnUsage(initialBudget(), {
      totalTokens: 1,
      cost: { total: 3 },
    });
    assert.equal(guard.shouldBlockStart(over), true);
    assert.equal(guard.evaluate(over).kind, "stop");
  });

  it("ignores unknown cost: malformed usage adds nothing to spend", () => {
    const guard = new BudgetGuard(configWith({ warnAt: 0.5, stopAt: 1 }));
    let budget = initialBudget();
    budget = addTurnUsage(budget, null);
    budget = addTurnUsage(budget, { totalTokens: 100 });
    budget = addTurnUsage(budget, { totalTokens: 100, cost: { total: "x" } });
    budget = addTurnUsage(budget, { totalTokens: 100, cost: { total: -1 } });
    assert.equal(budget.costTotal, 0, "no price information => no spend");
    assert.equal(guard.evaluate(budget).kind, "none");
    assert.equal(guard.shouldBlockStart(budget), false);
  });

  it("handles floating-point thresholds at exact boundaries", () => {
    const guard = new BudgetGuard(configWith({ warnAt: 0.3, stopAt: 0.6 }));
    let budget = initialBudget();
    // 0.1 + 0.2 in float is 0.30000000000000004: must still warn (>=).
    budget = addTurnUsage(budget, { totalTokens: 1, cost: { total: 0.1 } });
    budget = addTurnUsage(budget, { totalTokens: 1, cost: { total: 0.2 } });
    assert.equal(guard.evaluate(budget).kind, "warn");
  });
});

describe("budget copy", () => {
  it("renders the amounts and next action in user-facing messages", () => {
    const guard = new BudgetGuard(configWith({ warnAt: 2, stopAt: 5 }));
    const budget = addTurnUsage(initialBudget(), {
      totalTokens: 1,
      cost: { total: 5.4 },
    });
    const stop = stopMessage(guard, budget);
    assert.ok(stop.includes("$5.40"), stop);
    assert.ok(stop.includes("stopAt"), stop);
    const warnGuard = new BudgetGuard(configWith({ warnAt: 2, stopAt: 5 }));
    const warnBudget = addTurnUsage(initialBudget(), {
      totalTokens: 1,
      cost: { total: 2 },
    });
    const warn = warnMessage(warnGuard, warnBudget);
    assert.ok(warn.includes("$2.000"), warn);
  });

  it("formats USD with 3 decimals below $10", () => {
    assert.equal(usd(0.022), "$0.022");
    assert.equal(usd(12.345), "$12.35");
  });
});

describe("budget environment plumbing", () => {
  it("reads thresholds from the controller environment", () => {
    const previous = { ...process.env };
    try {
      process.env.PINEVIM_BUDGET_WARN = "1.5";
      process.env.PINEVIM_BUDGET_STOP = "4";
      assert.deepEqual(budgetFromEnv(), { warnAt: 1.5, stopAt: 4 });
      delete process.env.PINEVIM_BUDGET_WARN;
      delete process.env.PINEVIM_BUDGET_STOP;
      assert.deepEqual(budgetFromEnv(), BUDGET_DISABLED);
      process.env.PINEVIM_BUDGET_STOP = "not-a-number";
      assert.deepEqual(budgetFromEnv(), BUDGET_DISABLED);
    } finally {
      for (const key of Object.keys(process.env))
        if (!(key in previous)) delete process.env[key];
      Object.assign(process.env, previous);
    }
  });
});
