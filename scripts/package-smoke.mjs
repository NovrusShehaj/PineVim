import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const root = await mkdtemp(join(tmpdir(), "pv-pack-"));
try {
  const packed = JSON.parse(
    execFileSync("npm", ["pack", "--json", "--pack-destination", root], {
      encoding: "utf8",
    }),
  )[0];
  for (const { path } of packed.files) {
    if (
      !/^(dist\/|README.md$|package.json$|Docs\/(Compatibility|Testing|Implementation-Evidence).md$)/.test(
        path,
      )
    )
      throw new Error("Unexpected packaged file: " + path);
  }
  execFileSync(
    "npm",
    [
      "install",
      "--prefix",
      root,
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      join(root, packed.filename),
    ],
    { stdio: "pipe" },
  );
  const executable = join(root, "node_modules", ".bin", "pinevim");
  for (const flag of ["--help", "--version"]) {
    const output = execFileSync(executable, [flag], {
      env: { PATH: process.env.PATH, HOME: root, TERM: "dumb" },
      encoding: "utf8",
    });
    if (!output.includes("PineVim") && !output.includes("pinevim"))
      throw new Error("Missing CLI output");
  }
  const packageJson = JSON.parse(
    await readFile(
      join(root, "node_modules", "pinevim-local", "package.json"),
      "utf8",
    ),
  );
  if (packageJson.dependencies)
    throw new Error("Unexpected runtime dependency graph");
  const assets = await readdir(
    join(root, "node_modules", "pinevim-local", "dist", "adapters", "pi"),
  );
  if (!assets.includes("extension.js")) throw new Error("Missing extension");
  console.log(
    `PASS tarball ${packed.filename}: ${packed.files.length} allowlisted files, installed bin/help/version/assets, zero production npm dependencies`,
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
