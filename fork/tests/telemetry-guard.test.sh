#!/usr/bin/env bash
set -u

here="$(cd "$(dirname "$0")" && pwd)"
guard="$here/../telemetry-guard.mjs"
failures=0

check() {
  local name="$1" expect="$2" pattern="$3" dir="$4"
  local out status
  out="$(node "$guard" --root "$dir" --dist "$dir/apps/server/dist" 2>&1)"
  status=$?
  if [ "$status" -ne "$expect" ] || ! grep -qE -- "$pattern" <<< "$out"; then
    echo "FAIL $name: exit=$status"
    echo "$out" | sed 's/^/    /'
    failures=$((failures + 1))
  else
    echo "ok   $name"
  fi
}

fixture() {
  local dir
  dir="$(mktemp -d)"
  mkdir -p "$dir/apps/server/dist/client/assets" "$dir/apps/mobile" "$dir/apps/marketing" "$dir/infra/relay" "$dir/packages/shared"
  echo '{"name":"t3","dependencies":{"effect":"1"}}' > "$dir/apps/server/package.json"
  echo '{"name":"@t3tools/mobile","dependencies":{"expo-observe":"1"}}' > "$dir/apps/mobile/package.json"
  echo '{"name":"@t3tools/marketing","dependencies":{"@vercel/analytics":"1"}}' > "$dir/apps/marketing/package.json"
  echo '{"name":"@t3tools/relay","dependencies":{"@axiomhq/js":"1"}}' > "$dir/infra/relay/package.json"
  echo '{"name":"@t3tools/shared","dependencies":{"@opentelemetry/api":"1"}}' > "$dir/packages/shared/package.json"
  echo 'const relay = "/v1/mobile/observe/:projectId";' > "$dir/apps/server/dist/bin.mjs"
  echo '//# sourceMappingURL=bin.mjs.map https://ingest.t3.codes' > "$dir/apps/server/dist/bin.mjs.map"
  echo "$dir"
}

dir="$(fixture)"
check "clean build and allowed dependencies pass" 0 "No telemetry" "$dir"

echo 'fetch("https://ingest.t3.codes/batch", { body })' > "$dir/apps/server/dist/telemetry.mjs"
check "an ingest endpoint in the server bundle fails" 1 "telemetry\.mjs.*ingest\.t3\.codes" "$dir"
rm -rf "$dir"

dir="$(fixture)"
echo 'const key="phc_XOWci4oZP4VvLiEyrFqkFjP4CZn55mjYYBMREK5Wd6m";' > "$dir/apps/server/dist/client/assets/index.js"
check "an analytics key in the web client fails" 1 "index\.js.*phc_" "$dir"
rm -rf "$dir"

dir="$(fixture)"
echo 'headers:{"X-Axiom-Dataset":d}' > "$dir/apps/server/dist/client/assets/index.js"
check "an Axiom exporter in the web client fails" 1 "X-Axiom-Dataset" "$dir"
rm -rf "$dir"

dir="$(fixture)"
echo '{"name":"@t3tools/web","dependencies":{"@sentry/react":"1"}}' > "$dir/packages/shared/package.json"
check "a new telemetry SDK dependency fails" 1 "packages/shared/package\.json.*@sentry/react" "$dir"
rm -rf "$dir"

dir="$(fixture)"
echo '{"name":"@t3tools/web","devDependencies":{"posthog-js":"1"}}' > "$dir/apps/server/package.json"
check "a telemetry SDK as a dev dependency fails" 1 "posthog-js" "$dir"
rm -rf "$dir"

dir="$(fixture)"
echo '{"name":"t3","dependencies":{"expo-observe":"1"}}' > "$dir/apps/server/package.json"
check "an allowed SDK outside its package fails" 1 "apps/server/package\.json.*expo-observe" "$dir"
rm -rf "$dir"

dir="$(fixture)"
rm -rf "$dir/apps/server/dist"
check "a missing build fails instead of passing empty" 1 "No build output" "$dir"
rm -rf "$dir"

[ "$failures" -eq 0 ]
