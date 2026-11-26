#!/usr/bin/env bash
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
base="${1:-upstream/main}"

mapfile -t changed < <(git diff --name-only "$base" HEAD -- . \
  ':(exclude).github' ':(exclude)fork' ':(exclude)FORK.md')

mapfile -t filters < <(printf '%s\n' "${changed[@]}" | grep -oE '^(apps|packages)/[^/]+' | sort -u \
  | while read -r pkg; do [ -f "$pkg/package.json" ] && printf -- '--filter\n./%s\n' "$pkg"; done)
if [ "${#filters[@]}" -gt 0 ]; then
  echo "== typecheck"
  vp run --concurrency-limit 2 "${filters[@]}" typecheck
fi

mapfile -t tests < <(
  for file in "${changed[@]}"; do
    case "$file" in
      *.test.ts | *.test.tsx) [ -f "$file" ] && echo "$file" ;;
      *.ts | *.tsx)
        for test in "${file%.*}.test.ts" "${file%.*}.test.tsx"; do
          [ -f "$test" ] && echo "$test"
        done
        ;;
    esac
  done | sort -u
)
if [ "${#tests[@]}" -gt 0 ]; then
  echo "== tests of fork changes"
  vp test run "${tests[@]}"
fi

for test in "$here"/tests/*.test.sh; do
  echo "== $(basename "$test")"
  bash "$test"
done

echo "== build"
vp run --filter t3 build
(cd apps/desktop && node scripts/build-preview-annotation-css.mjs && vp pack)
echo "== telemetry"
node "$here/telemetry-guard.mjs" --dist apps/server/dist
