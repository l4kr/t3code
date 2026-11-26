#!/usr/bin/env node

import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { readAsar, readAsarFile, replaceAsarFile, writeAsar } from "./asar.mjs";
import { assertDesktopDist, swapDesktopDist } from "./desktop-dist.mjs";
import { assertServerDist, swapServerDist } from "./server-dist.mjs";

const UPSTREAM = "pingdotgg/t3code";
const APP_ID = "com.t3tools.t3code";
const PATCH_MARKER = "/* l4kr-fork: disable smooth scrolling */";
const PATCH_LINE = `${PATCH_MARKER} require("electron").app.commandLine.appendSwitch("disable-smooth-scrolling");\n`;

const args = parseArgs(process.argv.slice(2));
const installer = NodePath.resolve(required("installer"));
const tag = required("tag");
const [owner, repo] = required("repo").split("/");
const outDir = NodePath.resolve(required("out"));
const serverDistSource = args["server-dist"] ? NodePath.resolve(args["server-dist"]) : null;
const desktopDistSource = args["desktop-dist"] ? NodePath.resolve(args["desktop-dist"]) : null;
const workDir = NodePath.resolve(
  args.work ?? NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-repack-")),
);
const sevenZip = args["7z"] ?? "7z";

const appDir = NodePath.join(workDir, "app");
const nsisDir = NodePath.join(workDir, "nsis");
const projectDir = NodePath.join(workDir, "project");
const serverDistStage = NodePath.join(workDir, "server-dist");
for (const dir of [appDir, nsisDir, projectDir, serverDistStage])
  NodeFS.rmSync(dir, { recursive: true, force: true });
NodeFS.mkdirSync(outDir, { recursive: true });

run(sevenZip, ["x", "-y", `-o${nsisDir}`, installer, "$PLUGINSDIR/app-64.7z"]);
run(sevenZip, ["x", "-y", `-o${appDir}`, NodePath.join(nsisDir, "$PLUGINSDIR", "app-64.7z")]);

const resourcesDir = NodePath.join(appDir, "resources");
const asarPath = NodePath.join(resourcesDir, "app.asar");
const serverAsarPath = NodePath.join(resourcesDir, "server.asar");
const productExe = NodeFS.readdirSync(appDir).find(
  (name) => name.endsWith(".exe") && name.startsWith("T3 Code"),
);
if (!productExe) throw new Error(`No "T3 Code*.exe" in ${appDir}`);
const productName = productExe.slice(0, -".exe".length);

const asar = readAsar(asarPath);
const appPackage = JSON.parse(readAsarFile(asar, "package.json").toString("utf8"));
const version = appPackage.version;
if (`v${version}` !== tag) throw new Error(`Installer is ${version}, expected ${tag}`);
const appVersion = args["app-version"] ?? version;
replaceAsarFile(
  asar,
  "package.json",
  Buffer.from(JSON.stringify({ ...appPackage, version: appVersion }, null, 2), "utf8"),
);

if (desktopDistSource) {
  swapDesktopDist(asar, desktopDistSource, NodePath.join(workDir, "desktop-dist"));
  console.log(`Replaced apps/desktop/dist-electron with ${desktopDistSource}`);
}
const entry = readAsarFile(asar, appPackage.main).toString("utf8");
if (!entry.includes(PATCH_MARKER)) {
  replaceAsarFile(asar, appPackage.main, Buffer.from(PATCH_LINE + entry, "utf8"));
}
writeAsar(asarPath, asar);
const patched = readAsarFile(readAsar(asarPath), appPackage.main).toString("utf8");
if (!patched.startsWith(PATCH_LINE)) throw new Error("Entry patch did not stick");
console.log(`Patched ${appPackage.main}`);

if (serverDistSource) {
  const server = readAsar(serverAsarPath);
  swapServerDist(server, serverDistSource, serverDistStage);
  writeAsar(serverAsarPath, server);
  NodeFS.rmSync(NodePath.join(resourcesDir, "server-compile-cache"), {
    recursive: true,
    force: true,
  });
  console.log(`Replaced apps/server/dist with ${serverDistSource}`);
}

const appUpdateYml = [
  `owner: ${owner}`,
  `repo: ${repo}`,
  "provider: github",
  "releaseType: release",
  "updaterCacheDirName: t3code-updater",
  "",
].join("\n");
NodeFS.writeFileSync(NodePath.join(resourcesDir, "app-update.yml"), appUpdateYml);

const desktopPackage = JSON.parse(fetchUpstream("apps/desktop/package.json"));
const buildScript = fetchUpstream("scripts/build-desktop-artifact.ts");
if (!buildScript.includes(`DESKTOP_APP_ID = "${APP_ID}"`)) {
  throw new Error("Upstream changed DESKTOP_APP_ID; update fork/repack-windows.mjs");
}
const buildResources = NodePath.join(projectDir, "build-resources");
NodeFS.mkdirSync(buildResources, { recursive: true });
NodeFS.writeFileSync(
  NodePath.join(buildResources, "installer.nsh"),
  fetchUpstream("apps/desktop/resources/installer.nsh"),
);
const iconPath = fetchUpstream("scripts/lib/brand-assets.ts").match(
  /productionWindowsIconIco:\s*"([^"]+)"/,
)?.[1];
if (!iconPath)
  throw new Error("Upstream moved productionWindowsIconIco; update fork/repack-windows.mjs");
NodeFS.writeFileSync(NodePath.join(buildResources, "icon.ico"), fetchUpstream(iconPath, true));

NodeFS.writeFileSync(
  NodePath.join(projectDir, "package.json"),
  JSON.stringify(
    {
      name: appPackage.name,
      version: appVersion,
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
  nsis: { differentialPackage: true, include: NodePath.join(buildResources, "installer.nsh") },
  win: {
    target: ["nsis"],
    icon: NodePath.join(buildResources, "icon.ico"),
    signAndEditExecutable: false,
  },
  publish: [{ provider: "github", owner, repo, releaseType: "release" }],
};
const configPath = NodePath.join(projectDir, "electron-builder.json");
NodeFS.writeFileSync(configPath, JSON.stringify(builderConfig, null, 2));

const builderVersion =
  desktopPackage.devDependencies?.["electron-builder"] ??
  desktopPackage.dependencies?.["electron-builder"];
run(
  "npm",
  ["install", "--no-save", "--no-audit", "--no-fund", `electron-builder@${builderVersion}`],
  {
    cwd: projectDir,
    shell: true,
  },
);
const libVersion = JSON.parse(
  NodeFS.readFileSync(
    NodePath.join(projectDir, "node_modules", "app-builder-lib", "package.json"),
    "utf8",
  ),
).version;
const patchFile = fetchUpstream("pnpm-workspace.yaml").match(
  new RegExp(`app-builder-lib@${libVersion.replaceAll(".", "\\.")}:\\s*(\\S+)`),
)?.[1];
if (!patchFile)
  throw new Error(
    `Upstream has no patch for app-builder-lib@${libVersion}; update fork/repack-windows.mjs`,
  );
const patchPath = NodePath.join(projectDir, "app-builder-lib.patch");
NodeFS.writeFileSync(patchPath, fetchUpstream(patchFile));
run("patch", ["-p1", "-l", "--forward", "--batch", "-i", patchPath], {
  cwd: NodePath.join(projectDir, "node_modules", "app-builder-lib"),
});

run(
  process.execPath,
  [
    NodePath.join(projectDir, "node_modules", "electron-builder", "cli.js"),
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

const builtInstaller = NodePath.join(outDir, `T3-Code-${appVersion}-x64.exe`);
const verifyDir = NodePath.join(workDir, "verify");
NodeFS.rmSync(verifyDir, { recursive: true, force: true });
run(sevenZip, ["x", "-y", `-o${verifyDir}`, builtInstaller, "$PLUGINSDIR/app-64.7z"]);
run(sevenZip, [
  "x",
  "-y",
  `-o${verifyDir}`,
  NodePath.join(verifyDir, "$PLUGINSDIR", "app-64.7z"),
  "resources/app.asar",
  "resources/server.asar",
  "resources/app-update.yml",
]);
const builtApp = readAsar(NodePath.join(verifyDir, "resources", "app.asar"));
const builtEntry = readAsarFile(builtApp, appPackage.main).toString("utf8");
if (desktopDistSource) assertDesktopDist(builtApp, desktopDistSource);
const builtVersion = JSON.parse(readAsarFile(builtApp, "package.json").toString("utf8")).version;
if (builtVersion !== appVersion)
  throw new Error(`Built installer is version ${builtVersion}, expected ${appVersion}`);
const builtFeed = NodeFS.readFileSync(
  NodePath.join(verifyDir, "resources", "app-update.yml"),
  "utf8",
);
if (!builtEntry.startsWith(PATCH_LINE)) throw new Error("Built installer is missing the patch");
if (!builtFeed.includes(`owner: ${owner}`) || builtFeed.includes("publisherName")) {
  throw new Error(`Built installer has the wrong update feed:\n${builtFeed}`);
}
if (serverDistSource) {
  assertServerDist(
    readAsar(NodePath.join(verifyDir, "resources", "server.asar")),
    serverDistSource,
  );
}
for (const name of [
  `T3-Code-${appVersion}-x64.exe`,
  `T3-Code-${appVersion}-x64.exe.blockmap`,
  "latest.yml",
]) {
  if (!NodeFS.existsSync(NodePath.join(outDir, name))) throw new Error(`Missing output ${name}`);
}
console.log(`OK: ${builtInstaller}\n${builtFeed}`);

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
  NodeChildProcess.execFileSync(cmd, cmdArgs, { stdio: "inherit", ...options });
}

function fetchUpstream(file, binary = false) {
  const url = `https://raw.githubusercontent.com/${UPSTREAM}/${tag}/${file}`;
  const body = NodeChildProcess.execFileSync("curl", ["-sSLf", url], {
    maxBuffer: 64 * 1024 * 1024,
  });
  return binary ? body : body.toString("utf8");
}
