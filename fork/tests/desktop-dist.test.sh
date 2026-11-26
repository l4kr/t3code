#!/usr/bin/env bash
set -u

here="$(cd "$(dirname "$0")" && pwd)"
FORK_DIR="$(cd "$here/.." && pwd)" node --input-type=module - <<'EOF'
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

const { readAsar, readAsarFile, replaceAsarDir, writeAsar, listAsarDir } = await import(
  `${process.env.FORK_DIR}/asar.mjs`
);
const { swapDesktopDist } = await import(`${process.env.FORK_DIR}/desktop-dist.mjs`);

let failures = 0;
const work = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-desktop-dist-"));

function tree(root, files) {
  NodeFS.rmSync(root, { recursive: true, force: true });
  for (const [path, content] of Object.entries(files)) {
    NodeFS.mkdirSync(NodePath.dirname(NodePath.join(root, path)), { recursive: true });
    NodeFS.writeFileSync(NodePath.join(root, path), content);
  }
  return root;
}

function upstreamApp() {
  const archive = {
    header: { files: { apps: { files: { desktop: { files: { "dist-electron": { files: {} } } } } }, node_modules: { files: {} } } },
    data: Buffer.alloc(0),
  };
  replaceAsarDir(archive, "apps/desktop/dist-electron", tree(`${work}/upstream`, {
    "boot.cjs": "upstream boot",
    "main.cjs": 'upstream main; try { require("dbus-next"); } catch {}',
    "rolldown-runtime-AAAAAAAA.cjs": "runtime",
    "snapShot/RegionSnapShotWorker.cjs": "worker",
  }));
  replaceAsarDir(archive, "node_modules", tree(`${work}/modules`, {
    "ajv/package.json": "{}",
    "@clerk/electron/package.json": "{}",
  }));
  const file = `${work}/app.asar`;
  writeAsar(file, archive);
  return readAsar(file);
}

function check(name, files, expectError) {
  const archive = upstreamApp();
  const source = tree(`${work}/fork`, files);
  let error = null;
  try {
    swapDesktopDist(archive, source, `${work}/stage`);
    writeAsar(`${work}/out.asar`, archive);
  } catch (caught) {
    error = caught;
  }
  const ok = expectError ? error !== null && expectError.test(error.message) : error === null && check.after?.(readAsar(`${work}/out.asar`));
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `: ${error?.message ?? "no error"}`}`);
  if (!ok) failures += 1;
}

const forkBuild = {
  "boot.cjs": 'require("electron"); require("node:path"); require("fs");',
  "main.cjs": 'require("ajv/dist/runtime/validation_error"); require("@clerk/electron"); require("./rolldown-runtime-BBBBBBBB.cjs");',
  "main.cjs.map": "{}",
  "rolldown-runtime-BBBBBBBB.cjs": "runtime",
  "snapShot/RegionSnapShotWorker.cjs": "worker",
};

check.after = (archive) => {
  const files = listAsarDir(archive, "apps/desktop/dist-electron").sort();
  return (
    readAsarFile(archive, "apps/desktop/dist-electron/boot.cjs").toString() === forkBuild["boot.cjs"] &&
    !files.includes("main.cjs.map") &&
    !files.includes("rolldown-runtime-AAAAAAAA.cjs") &&
    files.includes("rolldown-runtime-BBBBBBBB.cjs")
  );
};
check("the fork's desktop build replaces upstream's, without source maps", forkBuild, null);

const { "snapShot/RegionSnapShotWorker.cjs": _worker, ...withoutWorker } = forkBuild;
check("an entry upstream ships that the fork build lacks fails", withoutWorker, /RegionSnapShotWorker\.cjs/);

check(
  "a module the app does not ship fails",
  { ...forkBuild, "main.cjs": forkBuild["main.cjs"] + ' require("left-pad");' },
  /left-pad/,
);

check(
  "an optional module upstream's own build also loads passes",
  { ...forkBuild, "main.cjs": forkBuild["main.cjs"] + ' try { require("dbus-next"); } catch {}' },
  null,
);

check("a build without boot.cjs fails", { "main.cjs": "x" }, /boot\.cjs/);

NodeFS.rmSync(work, { recursive: true, force: true });
process.exit(failures === 0 ? 0 : 1);
EOF
