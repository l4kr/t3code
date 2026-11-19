#!/usr/bin/env node

import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { listAsarDir, readAsar, readAsarFile } from "./asar.mjs";

const CLIENT_DIR = "apps/server/dist/client";
const VITE_BUILTINS = new Set(["BASE_URL", "MODE", "DEV", "PROD", "SSR"]);
const TELEMETRY = /OTLP/;

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .flatMap((arg, i, all) => (arg.startsWith("--") ? [[arg.slice(2), all[i + 1]]] : [])),
);
if (!args.installer && !args.asar) throw new Error("Missing --installer or --asar");
const work = NodeFS.mkdtempSync(NodePath.join(args.work ?? NodeOS.tmpdir(), "t3-env-"));

const archive = readAsar(args.asar ? NodePath.resolve(args.asar) : extractServerAsar());
const env = extractClientEnv(
  listAsarDir(archive, CLIENT_DIR)
    .filter((file) => file.endsWith(".js"))
    .map((file) => readAsarFile(archive, `${CLIENT_DIR}/${file}`).toString("utf8")),
);
NodeFS.rmSync(work, { recursive: true, force: true });

for (const [key, value] of Object.entries(env)) process.stdout.write(`${key}=${value}\n`);

function extractServerAsar() {
  const sevenZip = args["7z"] ?? "7z";
  const installerArchive = NodePath.join(work, "$PLUGINSDIR", "app-64.7z");
  const extract = (from, entry) =>
    NodeChildProcess.execFileSync(sevenZip, ["x", "-y", `-o${work}`, from, entry], {
      stdio: "ignore",
    });
  extract(NodePath.resolve(args.installer), "$PLUGINSDIR/app-64.7z");
  extract(installerArchive, "resources/server.asar");
  return NodePath.join(work, "resources", "server.asar");
}

function extractClientEnv(sources) {
  const literal = /\{(?:[A-Z][A-Z0-9_]*:(?:`[^`\\]*`|"[^"\\]*"|!0|!1),?)+\}/g;
  for (const source of sources) {
    for (const [object] of source.matchAll(literal)) {
      if (!object.includes("VITE_CLERK_PUBLISHABLE_KEY:")) continue;
      const env = {};
      for (const match of object.matchAll(/([A-Z][A-Z0-9_]*):(?:`([^`]*)`|"([^"]*)")/g)) {
        const key = match[1];
        const value = match[2] ?? match[3];
        if (value && !VITE_BUILTINS.has(key) && !TELEMETRY.test(key) && !value.includes("\n"))
          env[key] = value;
      }
      if (!env.VITE_CLERK_PUBLISHABLE_KEY || !env.APP_VERSION) break;
      return env;
    }
  }
  throw new Error(
    "Upstream client has no recognisable import.meta.env literal; update fork/upstream-client-env.mjs",
  );
}
