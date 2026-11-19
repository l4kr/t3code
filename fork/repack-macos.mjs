#!/usr/bin/env node

import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { readAsar, readAsarFile, replaceAsarFile, writeAsar } from "./asar.mjs";
import { assertServerDist, swapServerDist } from "./server-dist.mjs";

const MACH_O_MAGICS = new Set([
  0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe, 0xbebafeca,
]);
const RESTRICTED_ENTITLEMENT =
  /^(com\.apple\.developer\.|keychain-access-groups$|com\.apple\.application-identifier$|application-identifier$)/;

const args = parseArgs(process.argv.slice(2));
const zip = NodePath.resolve(required("zip"));
const tag = required("tag");
const arch = required("arch");
const [owner, repo] = required("repo").split("/");
const serverDistSource = NodePath.resolve(required("server-dist"));
const identity = required("identity");
const keychain = args.keychain ?? null;
const outDir = NodePath.resolve(required("out"));
const workDir = NodePath.resolve(required("work"));
const notary = ["APPLE_ID", "APPLE_APP_PASSWORD", "APPLE_TEAM_ID"].map((name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
});

const version = tag.replace(/^v/, "");
NodeFS.rmSync(workDir, { recursive: true, force: true });
NodeFS.mkdirSync(NodePath.join(workDir, "entitlements"), { recursive: true });
NodeFS.mkdirSync(outDir, { recursive: true });

run("ditto", ["-x", "-k", zip, NodePath.join(workDir, "app")]);
const appName = NodeFS.readdirSync(NodePath.join(workDir, "app")).find((name) =>
  name.endsWith(".app"),
);
if (!appName) throw new Error(`No .app in ${zip}`);
const appPath = NodePath.join(workDir, "app", appName);
const contents = NodePath.join(appPath, "Contents");
const resources = NodePath.join(contents, "Resources");
const infoPlist = NodePath.join(contents, "Info.plist");

const bundleVersion = plistBuddy(infoPlist, "Print :CFBundleShortVersionString");
if (bundleVersion !== version) throw new Error(`App is ${bundleVersion}, expected ${version}`);

const signables = collectSignables(appPath);
const entitlementsByItem = new Map(signables.map((item) => [item, readEntitlements(item)]));
console.log(`Found ${signables.length} signed items`);

const asarPath = NodePath.join(resources, "app.asar");
const asar = readAsar(asarPath);
const packageJson = JSON.parse(readAsarFile(asar, "package.json").toString("utf8"));
delete packageJson.t3codeWebAuthn;
replaceAsarFile(asar, "package.json", Buffer.from(JSON.stringify(packageJson, null, 2), "utf8"));
swapServerDist(asar, serverDistSource, NodePath.join(workDir, "server-dist"));
const headerHash = writeAsar(asarPath, asar);
plistBuddy(infoPlist, `Set :ElectronAsarIntegrity:Resources/app.asar:hash ${headerHash}`);
if (plistBuddy(infoPlist, "Print :ElectronAsarIntegrity:Resources/app.asar:hash") !== headerHash)
  throw new Error("ElectronAsarIntegrity hash did not update");
NodeFS.rmSync(NodePath.join(resources, "server-compile-cache"), { recursive: true, force: true });
NodeFS.rmSync(NodePath.join(contents, "embedded.provisionprofile"), { force: true });
NodeFS.writeFileSync(
  NodePath.join(resources, "app-update.yml"),
  [
    `owner: ${owner}`,
    `repo: ${repo}`,
    "provider: github",
    "releaseType: release",
    "updaterCacheDirName: t3code-updater",
    "",
  ].join("\n"),
);
console.log(`Patched ${appName}: server, update feed, asar integrity ${headerHash}`);

signables.forEach((item, index) => {
  const signArgs = ["--force", "--timestamp", "--options", "runtime", "--sign", identity];
  if (keychain) signArgs.push("--keychain", keychain);
  const entitlements = allowedEntitlements(entitlementsByItem.get(item), index);
  if (entitlements) signArgs.push("--entitlements", entitlements);
  run("codesign", [...signArgs, item], { quiet: true });
});
run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", appPath]);

const notarizeZip = NodePath.join(workDir, "notarize.zip");
run("ditto", ["-c", "-k", "--keepParent", appPath, notarizeZip]);
const [appleId, password, teamId] = notary;
const submission = JSON.parse(
  capture("xcrun", [
    "notarytool",
    "submit",
    notarizeZip,
    "--apple-id",
    appleId,
    "--password",
    password,
    "--team-id",
    teamId,
    "--wait",
    "--output-format",
    "json",
  ]),
);
console.log(`Notarization ${submission.id}: ${submission.status}`);
if (submission.status !== "Accepted") {
  console.log(
    capture("xcrun", [
      "notarytool",
      "log",
      submission.id,
      "--apple-id",
      appleId,
      "--password",
      password,
      "--team-id",
      teamId,
    ]),
  );
  throw new Error(`Notarization ${submission.status}`);
}
run("xcrun", ["stapler", "staple", appPath]);
run("spctl", ["--assess", "--type", "execute", "--verbose=2", appPath]);

assertServerDist(readAsar(asarPath), serverDistSource);
const outZip = NodePath.join(outDir, `T3-Code-${version}-${arch}.zip`);
run("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", appPath, outZip]);
console.log(`OK: ${outZip}`);

function collectSignables(root) {
  const found = [];
  const walk = (dir) => {
    for (const entry of NodeFS.readdirSync(dir, { withFileTypes: true })) {
      const full = NodePath.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        walk(full);
        if (/\.(app|framework)$/.test(entry.name)) found.push(full);
      } else if (entry.isFile() && isMachO(full)) {
        found.push(full);
      }
    }
  };
  walk(root);
  const depth = (item) => item.split(NodePath.sep).length;
  return [...found.toSorted((a, b) => depth(b) - depth(a)), root];
}

function isMachO(file) {
  const handle = NodeFS.openSync(file, "r");
  try {
    const head = Buffer.alloc(4);
    if (NodeFS.readSync(handle, head, 0, 4, 0) < 4) return false;
    return MACH_O_MAGICS.has(head.readUInt32BE(0));
  } finally {
    NodeFS.closeSync(handle);
  }
}

function readEntitlements(item) {
  const result = NodeChildProcess.spawnSync(
    "codesign",
    ["-d", "--entitlements", "-", "--xml", item],
    { encoding: "utf8" },
  );
  const xml = result.stdout?.trim() ?? "";
  return result.status === 0 && xml.startsWith("<?xml") ? xml : null;
}

function allowedEntitlements(xml, index) {
  if (!xml) return null;
  const xmlFile = NodePath.join(workDir, "entitlements", `${index}.plist`);
  const jsonFile = NodePath.join(workDir, "entitlements", `${index}.json`);
  NodeFS.writeFileSync(xmlFile, xml);
  const entitlements = JSON.parse(capture("plutil", ["-convert", "json", "-o", "-", xmlFile]));
  const kept = Object.fromEntries(
    Object.entries(entitlements).filter(([key]) => !RESTRICTED_ENTITLEMENT.test(key)),
  );
  if (Object.keys(kept).length === 0) return null;
  NodeFS.writeFileSync(jsonFile, JSON.stringify(kept));
  run("plutil", ["-convert", "xml1", "-o", xmlFile, jsonFile], { quiet: true });
  return xmlFile;
}

function plistBuddy(file, command) {
  return capture("/usr/libexec/PlistBuddy", ["-c", command, file]).trim();
}

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 2) parsed[argv[i].replace(/^--/, "")] = argv[i + 1];
  return parsed;
}

function required(name) {
  if (!args[name]) throw new Error(`Missing --${name}`);
  return args[name];
}

function run(cmd, cmdArgs, { quiet = false } = {}) {
  if (!quiet) console.log(`> ${cmd} ${cmdArgs.join(" ")}`);
  NodeChildProcess.execFileSync(cmd, cmdArgs, { stdio: "inherit" });
}

function capture(cmd, cmdArgs) {
  return NodeChildProcess.execFileSync(cmd, cmdArgs, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}
