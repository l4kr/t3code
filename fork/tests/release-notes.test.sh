#!/usr/bin/env bash
set -u

here="$(cd "$(dirname "$0")" && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
commit() {
  GIT_AUTHOR_NAME="$1" GIT_AUTHOR_EMAIL=a@example.com GIT_COMMITTER_NAME="$1" \
    GIT_COMMITTER_EMAIL=a@example.com git -C "$work/repo" commit -qm "$2"
}
change() {
  mkdir -p "$work/repo/$(dirname "$1")"
  echo "$RANDOM" >> "$work/repo/$1"
  git -C "$work/repo" add -A
}

git init -q -b main "$work/repo"
change src/app.ts && commit l4kr "Base"
git -C "$work/repo" tag v1.0.0-l4kr.1
git -C "$work/repo" checkout -q -b upstream
change src/upstream.ts && commit upstream "fix(web): an upstream fix (#1)"
git -C "$work/repo" checkout -q main
change src/links.ts && commit l4kr "Keep environment links valid however long they sit unused"
change fork/sync.sh && commit l4kr "Teach the sync script a new trick"
change .github/workflows/mirror-release.yml && commit l4kr "Run the release on a new runner"
GIT_AUTHOR_NAME=x GIT_AUTHOR_EMAIL=x@example.com GIT_COMMITTER_NAME=x GIT_COMMITTER_EMAIL=x@example.com \
  git -C "$work/repo" merge -q --no-ff -m "Merge pingdotgg/t3code v1.0.1" upstream
change apps/server/package.json && commit "github-actions[bot]" "Stamp version"
change apps/server/src/update.ts && commit l4kr "Install updates on their own once nothing on the machine is working"

cat > "$work/README.md" <<'EOF'
# T3 Code

Intro.

## How this fork differs from T3 Code

This is a fork.

- **No telemetry.**
- **Environment links don't expire.**

## Install

Upstream text.
EOF

WORK="$work" FORK_DIR="$(cd "$here/.." && pwd)" node --input-type=module - <<'NODE'
const { forkChanges, forkDifferences, releaseNotes } = await import(
  `${process.env.FORK_DIR}/release-notes.mjs`
);
const NodeFS = await import("node:fs");
let failures = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
  if (!ok) {
    console.log(`    ${detail}`);
    failures += 1;
  }
};

const changes = forkChanges(`${process.env.WORK}/repo`, "v1.0.0-l4kr.1");
check(
  "lists the fork's own changes since the last release, not upstream's, the bot's or release tooling",
  JSON.stringify(changes) ===
    JSON.stringify([
      "Keep environment links valid however long they sit unused",
      "Install updates on their own once nothing on the machine is working",
    ]),
  JSON.stringify(changes),
);
check("no previous release: no list", forkChanges(`${process.env.WORK}/repo`, null).length === 0, "");

const differences = forkDifferences(NodeFS.readFileSync(`${process.env.WORK}/README.md`, "utf8"));
check(
  "reads the README's list of differences",
  differences === "- **No telemetry.**\n- **Environment links don't expire.**",
  JSON.stringify(differences),
);

const upstreamNotes = "**v1.0.1** · 3 changes\n\n- **Workflow subjects.** Link runs.";
const fresh = releaseNotes({
  previousTag: "v1.0.0-l4kr.3",
  previousUpstreamTag: "v1.0.0",
  upstreamTag: "v1.0.1",
  forkChanges: changes,
  upstreamNotes,
  differences,
});
const sections = [...fresh.matchAll(/^## (.+)$/gm)].map((match) => match[1]);
check(
  "a new upstream version: a fork section, then upstream's notes, as separate sections",
  JSON.stringify(sections) === JSON.stringify(["This fork", "Upstream T3 Code v1.0.1"]) &&
    fresh.includes("Since v1.0.0-l4kr.3:\n\n- Keep environment links valid") &&
    fresh.includes(upstreamNotes),
  fresh,
);
check(
  "every release carries the full list of differences, folded away",
  fresh.includes("<summary>Everything this fork changes from T3 Code</summary>") &&
    fresh.includes("- **No telemetry.**"),
  fresh,
);

const forkOnly = releaseNotes({
  previousTag: "v1.0.1-l4kr.1",
  previousUpstreamTag: "v1.0.1",
  upstreamTag: "v1.0.1",
  forkChanges: ["Keep environment links valid however long they sit unused"],
  upstreamNotes,
  differences,
});
check(
  "a fork-only build says upstream is unchanged instead of repeating its notes",
  forkOnly.includes("## Upstream T3 Code v1.0.1\n\nUnchanged since v1.0.1-l4kr.1.") &&
    !forkOnly.includes("Workflow subjects"),
  forkOnly,
);

const upstreamOnly = releaseNotes({
  previousTag: "v1.0.0-l4kr.2",
  previousUpstreamTag: "v1.0.0",
  upstreamTag: "v1.0.1",
  forkChanges: [],
  upstreamNotes,
  differences,
});
check(
  "nothing new from the fork: no fork section",
  !upstreamOnly.includes("## This fork") && upstreamOnly.includes("## Upstream T3 Code v1.0.1"),
  upstreamOnly,
);
process.exit(failures === 0 ? 0 : 1);
NODE
