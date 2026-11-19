import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { listAsarDir, readAsarFile, replaceAsarDir } from "./asar.mjs";

export const SERVER_DIST = "apps/server/dist";
const CLIENT_DIR = `${SERVER_DIST}/client`;
const PROBES = ["bin.mjs", "client/index.html"];

export function swapServerDist(archive, sourceDir, stageDir) {
  for (const probe of PROBES) {
    if (!NodeFS.existsSync(NodePath.join(sourceDir, probe)))
      throw new Error(`No ${probe} in ${sourceDir}`);
  }
  NodeFS.rmSync(stageDir, { recursive: true, force: true });
  NodeFS.cpSync(sourceDir, stageDir, { recursive: true, filter: (src) => !src.endsWith(".map") });
  for (const file of listAsarDir(archive, CLIENT_DIR)) {
    if (file.includes("/") || file === "index.html") continue;
    NodeFS.writeFileSync(
      NodePath.join(stageDir, "client", file),
      readAsarFile(archive, `${CLIENT_DIR}/${file}`),
    );
  }
  replaceAsarDir(archive, SERVER_DIST, stageDir);
}

export function assertServerDist(archive, sourceDir) {
  for (const probe of PROBES) {
    const built = readAsarFile(archive, `${SERVER_DIST}/${probe}`);
    if (!built.equals(NodeFS.readFileSync(NodePath.join(sourceDir, probe))))
      throw new Error(`Built app is missing the fork's ${probe}`);
  }
}
