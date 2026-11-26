#!/usr/bin/env node

import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

const DESTINATIONS = [
  /ingest\.t3\.codes/,
  /\bphc_[A-Za-z0-9]{20,}/,
  /axiom\.co\b/,
  /X-Axiom-Dataset/i,
  /sentry\.io\b/,
  /posthog\.com\b/,
  /api(-js)?\.mixpanel\.com/,
  /amplitude\.com\b/,
  /api\.segment\.io/,
  /datadoghq\.(com|eu)/,
  /browser-intake-/,
  /honeycomb\.io\b/,
  /bugsnag\.com\b/,
  /logrocket\.(io|com)\b/,
  /nr-data\.net/,
  /applicationinsights\.azure\.com/,
  /google-analytics\.com/,
  /googletagmanager\.com/,
  /plausible\.io\b/,
  /clarity\.ms\b/,
  /google\.com\/s2\/favicons/,
  /icons\.duckduckgo\.com/,
];

const SDKS =
  /^(@sentry\/.+|sentry-expo|posthog-.+|@posthog\/.+|mixpanel.*|@amplitude\/.+|amplitude-js|@segment\/.+|analytics-node|@datadog\/.+|dd-trace|logrocket.*|@bugsnag\/.+|@vercel\/analytics|@vercel\/speed-insights|newrelic|@newrelic\/.+|@honeycombio\/.+|@axiomhq\/.+|@react-native-firebase\/(analytics|crashlytics|perf)|@firebase\/(analytics|performance)|expo-insights|expo-observe|applicationinsights|@microsoft\/applicationinsights-.+)$/;

const ALLOWED = { "apps/mobile/package.json": ["expo-observe"] };

const UNSHIPPED = new Set(["apps/marketing", "infra/relay", "infra/task-cache"]);

const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
];
const BUNDLE = /\.(m?js|cjs|html|json)$/;
const SOURCE = /(?<!\.test)\.(tsx?|jsx?)$/;
const CLERK_MOUNT = /<ClerkProvider\b(?:[^>{]|\{[^}]*\})*>/g;

const args = process.argv.slice(2);
const option = (name) =>
  args.flatMap((arg, i) => (arg === `--${name}` && args[i + 1] ? [args[i + 1]] : []));
const root = NodePath.resolve(option("root")[0] ?? ".");
const dists = option("dist").map((dir) => NodePath.resolve(root, dir));

const findings = [...scanDependencies(), ...scanSources(), ...dists.flatMap(scanBundle)];
if (findings.length > 0) {
  console.error(`Telemetry found (${findings.length}):`);
  for (const finding of findings) console.error(`  ${finding}`);
  console.error(
    "Cut it where the data leaves the process and keep its callers compiling; see FORK.md.",
  );
  process.exit(1);
}
console.log(
  `No telemetry in workspace dependencies, Clerk mounts${dists.length ? ` or ${dists.map((dir) => NodePath.relative(root, dir)).join(", ")}` : ""}.`,
);

function scanDependencies() {
  const manifests = ["package.json"];
  for (const group of ["apps", "packages", "infra"]) {
    const dir = NodePath.join(root, group);
    if (!NodeFS.existsSync(dir)) continue;
    for (const name of NodeFS.readdirSync(dir)) {
      const manifest = `${group}/${name}/package.json`;
      if (!UNSHIPPED.has(`${group}/${name}`) && NodeFS.existsSync(NodePath.join(root, manifest)))
        manifests.push(manifest);
    }
  }
  return manifests.flatMap((manifest) => {
    const path = NodePath.join(root, manifest);
    if (!NodeFS.existsSync(path)) return [];
    const json = JSON.parse(NodeFS.readFileSync(path, "utf8"));
    const allowed = ALLOWED[manifest] ?? [];
    return DEPENDENCY_FIELDS.flatMap((field) =>
      Object.keys(json[field] ?? {})
        .filter((name) => SDKS.test(name) && !allowed.includes(name))
        .map((name) => `${manifest}: ${field} has telemetry SDK ${name}`),
    );
  });
}

function shippedPackages() {
  return ["apps", "packages"].flatMap((group) => {
    const dir = NodePath.join(root, group);
    if (!NodeFS.existsSync(dir)) return [];
    return NodeFS.readdirSync(dir)
      .map((name) => `${group}/${name}`)
      .filter((pkg) => !UNSHIPPED.has(pkg) && NodeFS.existsSync(NodePath.join(root, pkg, "src")));
  });
}

function scanSources() {
  return shippedPackages().flatMap((pkg) =>
    walk(NodePath.join(root, pkg, "src"))
      .filter((file) => SOURCE.test(file))
      .flatMap((file) => {
        const text = NodeFS.readFileSync(file, "utf8");
        return [...text.matchAll(CLERK_MOUNT)]
          .filter(([tag]) => !/\btelemetry=\{false\}/.test(tag))
          .map(
            ([tag]) =>
              `${NodePath.relative(root, file)}: ${tag.replace(/\s+/g, " ")} keeps Clerk's own telemetry; pass telemetry={false}`,
          );
      }),
  );
}

function scanBundle(dir) {
  if (!NodeFS.existsSync(dir)) return [`No build output at ${NodePath.relative(root, dir)}`];
  return walk(dir)
    .filter((file) => BUNDLE.test(file))
    .flatMap((file) => {
      const text = NodeFS.readFileSync(file, "utf8");
      return DESTINATIONS.flatMap((pattern) => {
        const match = pattern.exec(text);
        if (!match) return [];
        const start = Math.max(0, match.index - 60);
        const context = text.slice(start, match.index + match[0].length + 60).replace(/\s+/g, " ");
        return [`${NodePath.relative(root, file)}: ${match[0]} in …${context}…`];
      });
    });
}

function walk(dir) {
  return NodeFS.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "node_modules") return [];
    const path = NodePath.join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}
