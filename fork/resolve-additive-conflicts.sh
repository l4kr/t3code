#!/usr/bin/env bash
set -euo pipefail

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
bar="$(printf '|%.0s' $(seq 32))"
eq="$(printf '=%.0s' $(seq 32))"

git diff --name-only -z --diff-filter=U | while IFS= read -r -d '' file; do
  for stage in 1 2 3; do
    git cat-file -e ":$stage:$file" 2>/dev/null || continue 2
    git show ":$stage:$file" > "$tmp/$stage"
  done
  status=0
  git merge-file -p --diff3 --marker-size=32 -L ours -L base -L theirs \
    "$tmp/2" "$tmp/1" "$tmp/3" > "$tmp/diff3" 2>/dev/null || status=$?
  if [ "$status" -eq 0 ] || [ "$status" -gt 127 ]; then continue; fi
  awk -v bar="$bar base" -v eq="$eq" '
    $0 == bar { inbase = 1; next }
    $0 == eq { inbase = 0; next }
    inbase { bad = 1 }
    END { exit bad }
  ' "$tmp/diff3" || continue
  git merge-file -p --union "$tmp/2" "$tmp/1" "$tmp/3" > "$file"
  git add -- "$file"
  printf '%s\n' "$file"
done
