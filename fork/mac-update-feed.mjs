#!/usr/bin/env node

import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .flatMap((arg, i, all) => (arg.startsWith("--") ? [[arg.slice(2), all[i + 1]]] : [])),
);
const { version, dir } = args;
if (!version || !dir)
  throw new Error("Usage: mac-update-feed.mjs --version <x.y.z> --dir <release dir>");

const zips = ["arm64", "x64"]
  .map((arch) => `T3-Code-${version}-${arch}.zip`)
  .filter((name) => NodeFS.existsSync(NodePath.join(dir, name)));

if (zips.length === 0) {
  console.log("No macOS zips; skipping latest-mac.yml");
} else {
  const files = zips.map((name) => {
    const content = NodeFS.readFileSync(NodePath.join(dir, name));
    const sha512 = NodeCrypto.createHash("sha512").update(content).digest("base64");
    return `  - url: ${name}\n    sha512: ${sha512}\n    size: ${content.length}`;
  });
  const feed = [
    `version: '${version}'`,
    "files:",
    ...files,
    `releaseDate: '${new Date().toISOString()}'`,
    "",
  ].join("\n");
  NodeFS.writeFileSync(NodePath.join(dir, "latest-mac.yml"), feed);
  console.log(feed);
}
