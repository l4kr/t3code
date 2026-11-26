#!/usr/bin/env bash
set -u

here="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$here/../.." && pwd)" node --input-type=module - <<'NODE'
const NodeFS = await import("node:fs");
const { forkDifferences } = await import(`${process.env.ROOT}/fork/release-notes.mjs`);
const titles = (text) =>
  [...text.matchAll(/^- \*\*(.+?)\*\*/gm)].map((match) => match[1].replace(/[.:]$/, ""));
const forkMd = NodeFS.readFileSync(`${process.env.ROOT}/FORK.md`, "utf8");
const changes = forkMd.slice(0, forkMd.indexOf("\n## "));
const readme = titles(forkDifferences(NodeFS.readFileSync(`${process.env.ROOT}/README.md`, "utf8")));
const missing = titles(changes).filter((title) => !readme.includes(title));
if (missing.length > 0) {
  console.log(`FAIL every fork change in FORK.md is listed in the README; missing: ${missing.join(", ")}`);
  process.exit(1);
}
console.log(`ok   every fork change in FORK.md is listed in the README (${readme.length} items)`);
NODE
