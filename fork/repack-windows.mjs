#!/usr/bin/env node
// Turns an official upstream Windows installer into this fork's installer:
//   1. unpack the app from the upstream NSIS installer,
//   2. prepend one line to the Electron entry that disables Chromium smooth scrolling,
//   3. point the updater at this fork's GitHub Releases,
//   4. rebuild the NSIS installer + latest.yml with electron-builder.
// Everything else stays byte-identical to the upstream build.
//
// Usage: node fork/repack-windows.mjs --installer <T3-Code-x.y.z-x64.exe> --tag <vX.Y.Z>
//          --repo <owner/name> --out <dir> [--work <dir>] [--7z <path to 7z.exe>]

import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const UPSTREAM = "pingdotgg/t3code";
const APP_ID = "com.t3tools.t3code";
const PATCH_MARKER = "/* l4kr-fork: disable smooth scrolling */";
const PATCH_LINE = `${PATCH_MARKER} require("electron").app.commandLine.appendSwitch("disable-smooth-scrolling");\n`;

const args = parseArgs(process.argv.slice(2));
const installer = path.resolve(required("installer"));
const tag = required("tag");
const [owner, repo] = required("repo").split("/");
const outDir = path.resolve(required("out"));
const workDir = path.resolve(args.work ?? fs.mkdtempSync(path.join(os.tmpdir(), "t3-repack-")));
const sevenZip = args["7z"] ?? "7z";

const appDir = path.join(workDir, "app");
const nsisDir = path.join(workDir, "nsis");
const projectDir = path.join(workDir, "project");
for (const dir of [appDir, nsisDir, projectDir]) fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

// 1. Unpack. electron-builder installers carry the whole app as $PLUGINSDIR/app-64.7z.
run(sevenZip, ["x", "-y", `-o${nsisDir}`, installer, "$PLUGINSDIR/app-64.7z"]);
run(sevenZip, ["x", "-y", `-o${appDir}`, path.join(nsisDir, "$PLUGINSDIR", "app-64.7z")]);

const resourcesDir = path.join(appDir, "resources");
const asarPath = path.join(resourcesDir, "app.asar");
const productExe = fs
  .readdirSync(appDir)
  .find((name) => name.endsWith(".exe") && name.startsWith("T3 Code"));
if (!productExe) throw new Error(`No "T3 Code*.exe" in ${appDir}`);
const productName = productExe.slice(0, -".exe".length);

// 2. Patch the Electron entry inside app.asar.
const asar = readAsar(asarPath);
const appPackage = JSON.parse(readAsarFile(asar, "package.json").toString("utf8"));
const version = appPackage.version;
if (`v${version}` !== tag) throw new Error(`Installer is ${version}, expected ${tag}`);

const entry = readAsarFile(asar, appPackage.main).toString("utf8");
if (!entry.includes(PATCH_MARKER)) {
  replaceAsarFile(asar, appPackage.main, Buffer.from(PATCH_LINE + entry, "utf8"));
  writeAsar(asarPath, asar);
}
const patched = readAsarFile(readAsar(asarPath), appPackage.main).toString("utf8");
if (!patched.startsWith(PATCH_LINE)) throw new Error("Entry patch did not stick");
console.log(`Patched ${appPackage.main}:\n${patched}`);

// 3. Updater feed -> this fork. No publisherName: these builds are unsigned, and
// electron-updater skips signature verification when it is absent.
const appUpdateYml = [
  `owner: ${owner}`,
  `repo: ${repo}`,
  "provider: github",
  "releaseType: release",
  "updaterCacheDirName: t3code-updater",
  "",
].join("\n");
fs.writeFileSync(path.join(resourcesDir, "app-update.yml"), appUpdateYml);

// 4. Rebuild the installer with upstream's own NSIS customisations and tool versions.
const desktopPackage = JSON.parse(fetchUpstream("apps/desktop/package.json"));
const buildScript = fetchUpstream("scripts/build-desktop-artifact.ts");
if (!buildScript.includes(`DESKTOP_APP_ID = "${APP_ID}"`)) {
  throw new Error("Upstream changed DESKTOP_APP_ID; update fork/repack-windows.mjs");
}
const buildResources = path.join(projectDir, "build-resources");
fs.mkdirSync(buildResources, { recursive: true });
fs.writeFileSync(path.join(buildResources, "installer.nsh"), fetchUpstream("apps/desktop/resources/installer.nsh"));
const iconPath = fetchUpstream("scripts/lib/brand-assets.ts").match(/productionWindowsIconIco:\s*"([^"]+)"/)?.[1];
if (!iconPath) throw new Error("Upstream moved productionWindowsIconIco; update fork/repack-windows.mjs");
fs.writeFileSync(path.join(buildResources, "icon.ico"), fetchUpstream(iconPath, true));

fs.writeFileSync(
  path.join(projectDir, "package.json"),
  JSON.stringify(
    {
      name: appPackage.name,
      version,
      productName,
      description: appPackage.description,
      author: appPackage.author,
      homepage: appPackage.homepage,
      license: appPackage.license,
    },
    null,
    2,
  ),
);

const builderConfig = {
  appId: APP_ID,
  productName,
  artifactName: "T3-Code-${version}-${arch}.${ext}",
  electronVersion: desktopPackage.dependencies.electron,
  npmRebuild: false,
  directories: { output: outDir, buildResources },
  nsis: { differentialPackage: true, include: path.join(buildResources, "installer.nsh") },
  win: { target: ["nsis"], icon: path.join(buildResources, "icon.ico"), signAndEditExecutable: false },
  publish: [{ provider: "github", owner, repo, releaseType: "release" }],
};
const configPath = path.join(projectDir, "electron-builder.json");
fs.writeFileSync(configPath, JSON.stringify(builderConfig, null, 2));

// Same electron-builder as upstream, with upstream's pnpm patch to app-builder-lib applied.
const builderVersion = desktopPackage.devDependencies?.["electron-builder"] ?? desktopPackage.dependencies?.["electron-builder"];
run("npm", ["install", "--no-save", "--no-audit", "--no-fund", `electron-builder@${builderVersion}`], {
  cwd: projectDir,
  shell: process.platform === "win32",
});
const libVersion = JSON.parse(
  fs.readFileSync(path.join(projectDir, "node_modules", "app-builder-lib", "package.json"), "utf8"),
).version;
const patchFile = fetchUpstream("pnpm-workspace.yaml").match(
  new RegExp(`app-builder-lib@${libVersion.replaceAll(".", "\\.")}:\\s*(\\S+)`),
)?.[1];
if (!patchFile) throw new Error(`Upstream has no patch for app-builder-lib@${libVersion}; update fork/repack-windows.mjs`);
const patchPath = path.join(projectDir, "app-builder-lib.patch");
fs.writeFileSync(patchPath, fetchUpstream(patchFile));
// GNU patch (ships with Git for Windows): pnpm's patch files drop trailing whitespace
// from context lines, which `git apply` refuses and `patch -l` tolerates, like pnpm does.
run("patch", ["-p1", "-l", "--forward", "--batch", "-i", patchPath], {
  cwd: path.join(projectDir, "node_modules", "app-builder-lib"),
});

run(
  process.execPath,
  [
    path.join(projectDir, "node_modules", "electron-builder", "cli.js"),
    "--win",
    "nsis",
    "--x64",
    "--prepackaged",
    appDir,
    "--projectDir",
    projectDir,
    "--config",
    configPath,
    "--publish",
    "never",
  ],
  { cwd: projectDir },
);

// 5. Check the result: the rebuilt installer must carry the patch and the fork feed.
const builtInstaller = path.join(outDir, `T3-Code-${version}-x64.exe`);
const verifyDir = path.join(workDir, "verify");
fs.rmSync(verifyDir, { recursive: true, force: true });
run(sevenZip, ["x", "-y", `-o${verifyDir}`, builtInstaller, "$PLUGINSDIR/app-64.7z"]);
run(sevenZip, ["x", "-y", `-o${verifyDir}`, path.join(verifyDir, "$PLUGINSDIR", "app-64.7z"), "resources/app.asar", "resources/app-update.yml"]);
const builtEntry = readAsarFile(readAsar(path.join(verifyDir, "resources", "app.asar")), appPackage.main).toString("utf8");
const builtFeed = fs.readFileSync(path.join(verifyDir, "resources", "app-update.yml"), "utf8");
if (!builtEntry.startsWith(PATCH_LINE)) throw new Error("Built installer is missing the patch");
if (!builtFeed.includes(`owner: ${owner}`) || builtFeed.includes("publisherName")) {
  throw new Error(`Built installer has the wrong update feed:\n${builtFeed}`);
}
for (const name of [`T3-Code-${version}-x64.exe`, `T3-Code-${version}-x64.exe.blockmap`, "latest.yml"]) {
  if (!fs.existsSync(path.join(outDir, name))) throw new Error(`Missing output ${name}`);
}
console.log(`OK: ${builtInstaller}\n${builtFeed}`);

// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 2) parsed[argv[i].replace(/^--/, "")] = argv[i + 1];
  return parsed;
}

function required(name) {
  if (!args[name]) throw new Error(`Missing --${name}`);
  return args[name];
}

function run(cmd, cmdArgs, options = {}) {
  console.log(`> ${cmd} ${cmdArgs.join(" ")}`);
  execFileSync(cmd, cmdArgs, { stdio: "inherit", ...options });
}

function fetchUpstream(file, binary = false) {
  const url = `https://raw.githubusercontent.com/${UPSTREAM}/${tag}/${file}`;
  const body = execFileSync("curl", ["-sSLf", url], { maxBuffer: 64 * 1024 * 1024 });
  return binary ? body : body.toString("utf8");
}

// Minimal asar reader/writer. Layout: [UInt32 4][UInt32 headerPickleSize]
// [UInt32 payloadSize][Int32 jsonLength][json, padded to 4][file data...].
// Changed files are appended to the data section; all other bytes stay put.
function readAsar(file) {
  const buf = fs.readFileSync(file);
  const headerPickleSize = buf.readUInt32LE(4);
  const jsonLength = buf.readInt32LE(12);
  const header = JSON.parse(buf.subarray(16, 16 + jsonLength).toString("utf8"));
  return { header, data: buf.subarray(8 + headerPickleSize) };
}

function asarEntry(archive, filePath) {
  let node = archive.header;
  for (const part of filePath.split(/[\\/]/).filter(Boolean)) {
    node = node.files?.[part];
    if (!node) throw new Error(`${filePath} not found in asar`);
  }
  if (node.unpacked) throw new Error(`${filePath} is unpacked; cannot patch in place`);
  return node;
}

function readAsarFile(archive, filePath) {
  const node = asarEntry(archive, filePath);
  const offset = Number(node.offset);
  return archive.data.subarray(offset, offset + node.size);
}

function replaceAsarFile(archive, filePath, content) {
  const node = asarEntry(archive, filePath);
  node.offset = String(archive.data.length);
  node.size = content.length;
  if (node.integrity) {
    const blockSize = node.integrity.blockSize;
    const blocks = [];
    for (let i = 0; i < Math.max(content.length, 1); i += blockSize) {
      blocks.push(sha256(content.subarray(i, i + blockSize)));
    }
    node.integrity = { ...node.integrity, hash: sha256(content), blocks };
  }
  archive.data = Buffer.concat([archive.data, content]);
}

function writeAsar(file, archive) {
  const json = Buffer.from(JSON.stringify(archive.header), "utf8");
  const padded = Math.ceil(json.length / 4) * 4;
  const headerPickle = Buffer.alloc(8 + padded);
  headerPickle.writeUInt32LE(4 + padded, 0);
  headerPickle.writeInt32LE(json.length, 4);
  json.copy(headerPickle, 8);
  const sizePickle = Buffer.alloc(8);
  sizePickle.writeUInt32LE(4, 0);
  sizePickle.writeUInt32LE(headerPickle.length, 4);
  fs.writeFileSync(file, Buffer.concat([sizePickle, headerPickle, archive.data]));
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}
