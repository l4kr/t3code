#!/usr/bin/env bash
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
list="${FORK_OWNED:-$here/fork-owned.txt}"
side="${FORK_SIDE:-ours}"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

owned() { grep -qxF -- "$1" "$list"; }
fork_stage=2
[ "$side" = theirs ] && fork_stage=3

git diff --name-only -z --diff-filter=U | while IFS= read -r -d '' file; do
  owned "$file" || continue
  if ! git cat-file -e ":$fork_stage:$file" 2> /dev/null; then
    git rm -q -f -- "$file"
  elif git cat-file -e ":1:$file" 2> /dev/null && git cat-file -e ":2:$file" 2> /dev/null \
    && git cat-file -e ":3:$file" 2> /dev/null; then
    for stage in 1 2 3; do git show ":$stage:$file" > "$tmp/$stage"; done
    git merge-file -p "--$side" "$tmp/2" "$tmp/1" "$tmp/3" > "$file"
    git add -- "$file"
  else
    git show ":$fork_stage:$file" > "$file"
    git add -- "$file"
  fi
  printf '%s\n' "$file"
done
