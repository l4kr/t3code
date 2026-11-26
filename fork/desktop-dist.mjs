import * as NodeFS from "node:fs";
import * as NodeModule from "node:module";
import * as NodePath from "node:path";

import { listAsarDir, readAsarFile, replaceAsarDir } from "./asar.mjs";

export const DESKTOP_DIST = "apps/desktop/dist-electron";
const PROBES = ["boot.cjs", "main.cjs"];
const HASHED_CHUNK = /-[A-Za-z0-9_-]{8}\.cjs$/;
const BARE_REQUIRE = /require\(\s*["']([^"'./][^"']*)["']\s*\)/g;
const BUILTINS = new Set(NodeModule.builtinModules);

export function swapDesktopDist(archive, sourceDir, stageDir) {
  for (const probe of PROBES) {
    if (!NodeFS.existsSync(NodePath.join(sourceDir, probe)))
      throw new Error(`No ${probe} in ${sourceDir}`);
  }
  const built = walk(sourceDir).filter((file) => !file.endsWith(".map"));
  const missing = listAsarDir(archive, DESKTOP_DIST).filter(
    (file) => !HASHED_CHUNK.test(file) && !built.includes(file),
  );
  if (missing.length > 0)
    throw new Error(`The fork's desktop build lacks upstream's ${missing.join(", ")}`);

  const upstreamLoads = new Set(
    listAsarDir(archive, DESKTOP_DIST).flatMap((file) =>
      requiredPackages(readAsarFile(archive, `${DESKTOP_DIST}/${file}`).toString("utf8")),
    ),
  );
  const unresolved = new Set(
    built
      .filter((file) => file.endsWith(".cjs"))
      .flatMap((file) =>
        requiredPackages(NodeFS.readFileSync(NodePath.join(sourceDir, file), "utf8")),
      )
      .filter((name) => !upstreamLoads.has(name) && !shipsModule(archive, name)),
  );
  if (unresolved.size > 0)
    throw new Error(
      `The fork's desktop build loads modules the app does not ship: ${[...unresolved].join(", ")}`,
    );

  NodeFS.rmSync(stageDir, { recursive: true, force: true });
  NodeFS.cpSync(sourceDir, stageDir, { recursive: true, filter: (src) => !src.endsWith(".map") });
  replaceAsarDir(archive, DESKTOP_DIST, stageDir);
}

export function assertDesktopDist(archive, sourceDir) {
  for (const probe of PROBES) {
    const built = readAsarFile(archive, `${DESKTOP_DIST}/${probe}`);
    const source = NodeFS.readFileSync(NodePath.join(sourceDir, probe));
    if (!built.subarray(built.length - source.length).equals(source))
      throw new Error(`Built app is missing the fork's desktop ${probe}`);
  }
}

function requiredPackages(text) {
  return [...text.matchAll(BARE_REQUIRE)]
    .map(([, specifier]) => specifier)
    .filter((specifier) => !specifier.startsWith("node:"))
    .map(packageName)
    .filter((name) => name !== "electron" && !BUILTINS.has(name));
}

function shipsModule(archive, name) {
  let node = archive.header.files.node_modules;
  for (const part of name.split("/")) node = node?.files?.[part];
  return node?.files !== undefined;
}

function packageName(specifier) {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

function walk(dir, prefix = "") {
  return NodeFS.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    return entry.isDirectory() ? walk(NodePath.join(dir, entry.name), rel) : [rel];
  });
}
