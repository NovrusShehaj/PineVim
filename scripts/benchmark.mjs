import { performance } from "node:perf_hooks";
import { harness } from "../build/tests/integration/harness.js";
const p95 = (values) =>
  values.sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1];
const { execFileSync } = await import("node:child_process");
const overhead = JSON.parse(
  execFileSync("python3", ["tests/terminal/transport.py", "--benchmark"], {
    encoding: "utf8",
    timeout: 120000,
  }),
);
const h = await harness();
try {
  await h.controller.intent("ide.open");
  const reveal = [];
  for (let i = 0; i < 40; i++) {
    const start = performance.now();
    await h.controller.intent(i % 2 ? "agent.show" : "agent.hide");
    reveal.push(performance.now() - start);
  }
  const cpu = process.cpuUsage(),
    start = performance.now();
  await new Promise((resolve) => setTimeout(resolve, 60000));
  const used = process.cpuUsage(cpu),
    elapsed = performance.now() - start;
  console.log(
    JSON.stringify(
      {
        fullCliPrelaunchP95Ms: p95(
          overhead.map((sample) => sample.prelaunchMs),
        ),
        launchToBridgeP95Ms: p95(
          overhead.map((sample) => sample.launchToBridgeMs),
        ),
        livePaneP95Ms: p95(reveal),
        controllerIdleCpuPercent:
          ((used.user + used.system) / 1000 / elapsed) * 100,
        idleSeconds: elapsed / 1000,
        notes:
          "20 fresh CLI processes with warm filesystem caches; logged immediately before tmux Pi launch. Idle includes controller process only; child tmux helper CPU excluded.",
      },
      null,
      2,
    ),
  );
} finally {
  await h.close();
}
