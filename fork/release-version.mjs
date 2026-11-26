#!/usr/bin/env node

import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeURL from "node:url";

const forkBuild = (upstreamTag, tag) => {
  const base = upstreamTag.replace(/^v/, "").replaceAll(".", "\\.");
  const n = Number(new RegExp(`^v${base}-l4kr\\.(\\d+)$`).exec(tag)?.[1]);
  return Number.isInteger(n) && n > 0 ? n : null;
};

export function latestForkTag(upstreamTag, tags) {
  let best = null;
  for (const tag of tags) {
    const n = forkBuild(upstreamTag, tag);
    if (n !== null && (best === null || n > best.n)) best = { tag, n };
  }
  return best?.tag ?? null;
}

export function nextRelease({ upstreamTag, last, mainSha }) {
  const base = upstreamTag.replace(/^v/, "");
  const lastBuild = last ? forkBuild(upstreamTag, last.tag) : null;
  if (lastBuild !== null && last.sha === mainSha) return null;
  const n = (lastBuild ?? 0) + 1;
  return { version: `${base}-l4kr.${n}`, tag: `v${base}-l4kr.${n}` };
}

if (process.argv[1] === NodeURL.fileURLToPath(import.meta.url)) {
  const gh = (...args) => NodeChildProcess.execFileSync("gh", args, { encoding: "utf8" }).trim();
  const repo = process.env.REPO;
  const upstreamTag = gh(
    "api",
    `repos/${process.env.UPSTREAM}/releases/latest`,
    "--jq",
    ".tag_name",
  );
  const tags = gh(
    "api",
    "--paginate",
    `repos/${repo}/releases?per_page=100`,
    "--jq",
    ".[].tag_name",
  )
    .split("\n")
    .filter(Boolean);
  const lastTag = latestForkTag(upstreamTag, tags);
  const last = lastTag
    ? { tag: lastTag, sha: gh("api", `repos/${repo}/commits/${lastTag}`, "--jq", ".sha") }
    : null;
  const mainSha = gh("api", `repos/${repo}/commits/main`, "--jq", ".sha");
  const next = nextRelease({ upstreamTag, last, mainSha });
  const lines = [
    `upstream_tag=${upstreamTag}`,
    `upstream_version=${upstreamTag.replace(/^v/, "")}`,
    ...(next ? [`version=${next.version}`, `tag=${next.tag}`] : ["skip=true"]),
  ];
  console.log(next ? `Releasing ${next.tag}` : `${lastTag} is current.`);
  if (process.env.GITHUB_OUTPUT)
    NodeFS.appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join("\n")}\n`);
  else console.log(lines.join("\n"));
}
