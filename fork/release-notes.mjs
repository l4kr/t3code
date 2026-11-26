#!/usr/bin/env node

import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeURL from "node:url";

const DIFFERENCES_HEADING = "## How this fork differs from T3 Code";
const TOOLING = (file) =>
  file.startsWith("fork/") ||
  file.startsWith(".github/") ||
  file === "FORK.md" ||
  file === "README.md";

export function forkChanges(dir, previousTag) {
  if (!previousTag) return [];
  const git = (...args) =>
    NodeChildProcess.execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" }).trim();
  const lines = (text) => text.split("\n").filter(Boolean);
  return lines(git("rev-list", "--first-parent", "--reverse", `${previousTag}..HEAD`)).flatMap(
    (sha) => {
      const [author, subject] = git("show", "-s", "--format=%an%x1f%s", sha).split("\x1f");
      if (author === "github-actions[bot]") return [];
      const merge = git("rev-list", "--parents", "-n", "1", sha).split(" ").length > 2;
      if (merge) return subject.startsWith("Merge pingdotgg/") ? [] : [subject];
      const files = lines(git("diff-tree", "--no-commit-id", "--name-only", "-r", sha));
      return files.every(TOOLING) ? [] : [subject];
    },
  );
}

export function forkDifferences(readme) {
  const lines = readme.split("\n");
  const start = lines.indexOf(DIFFERENCES_HEADING);
  if (start === -1) return "";
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("## "));
  return (end === -1 ? rest : rest.slice(0, end)).join("\n").trim();
}

export function releaseNotes({
  previousTag,
  previousUpstreamTag,
  upstreamTag,
  forkChanges: changes,
  upstreamNotes,
  differences,
}) {
  const sections = [];
  if (changes.length > 0) {
    sections.push(
      [
        "## This fork",
        previousTag ? `Since ${previousTag}:` : null,
        changes.map((change) => `- ${change}`).join("\n"),
      ]
        .filter(Boolean)
        .join("\n\n"),
    );
  }
  const upstreamUnchanged = previousTag && previousUpstreamTag === upstreamTag;
  sections.push(
    `## Upstream T3 Code ${upstreamTag}\n\n${
      upstreamUnchanged ? `Unchanged since ${previousTag}.` : upstreamNotes.trim()
    }`,
  );
  if (differences) {
    sections.push(
      `<details>\n<summary>Everything this fork changes from T3 Code</summary>\n\n${differences}\n\n</details>`,
    );
  }
  return `${sections.join("\n\n")}\n`;
}

if (process.argv[1] === NodeURL.fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const option = (name) => args[args.indexOf(`--${name}`) + 1];
  const gh = (...ghArgs) =>
    NodeChildProcess.execFileSync("gh", ghArgs, { encoding: "utf8" }).trim();
  const upstreamTag = option("upstream-tag");
  let previousTag = null;
  try {
    previousTag =
      gh("api", `repos/${process.env.REPO}/releases/latest`, "--jq", ".tag_name") || null;
  } catch {
    previousTag = null;
  }
  const notes = releaseNotes({
    previousTag,
    previousUpstreamTag: previousTag?.replace(/-l4kr\.\d+$/, "") ?? null,
    upstreamTag,
    forkChanges: forkChanges(".", previousTag),
    upstreamNotes: gh(
      "release",
      "view",
      upstreamTag,
      "--repo",
      process.env.UPSTREAM,
      "--json",
      "body",
      "--jq",
      ".body",
    ),
    differences: forkDifferences(NodeFS.readFileSync("README.md", "utf8")),
  });
  NodeFS.writeFileSync(option("out"), notes);
  console.log(notes);
}
