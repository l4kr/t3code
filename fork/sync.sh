#!/usr/bin/env bash
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
UPSTREAM="${UPSTREAM:-pingdotgg/t3code}"
url="${UPSTREAM_URL:-https://github.com/$UPSTREAM.git}"
summary="${GITHUB_STEP_SUMMARY:-/dev/null}"
output="${GITHUB_OUTPUT:-/dev/null}"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

bullets() { sed 's/^/- `/; s/$/`/'; }

with_markers() {
  local file
  for file in "$@"; do
    [ -f "$file" ] && grep -qE '^(<{7}|>{7})( |$)' -- "$file" && printf '%s\n' "$file"
  done
  return 0
}

merge() {
  git fetch --no-tags "$url" +refs/heads/main:refs/remotes/upstream/main
  if git merge-base --is-ancestor upstream/main HEAD; then
    echo "Already up to date with $UPSTREAM."
    return 0
  fi
  local start
  start="$(git rev-parse HEAD)"
  git ls-files .github/workflows | sort -u > "$tmp/fork-workflows"
  git merge --no-ff --no-commit upstream/main > /dev/null 2>&1 || true

  git diff --name-only --diff-filter=U -- fork/upstream-workflows | while read -r file; do
    if git cat-file -e ":3:$file" 2> /dev/null; then
      git checkout --theirs -- "$file" && git add -- "$file"
    else
      git rm -q -f -- "$file"
    fi
  done
  git ls-files .github/workflows | sort -u | comm -23 - "$tmp/fork-workflows" | while read -r file; do
    target="fork/upstream-workflows/$(basename "$file")"
    for stage in 0 3; do
      if git cat-file -e ":$stage:$file" 2> /dev/null; then git show ":$stage:$file" > "$target"; break; fi
    done
    git rm -q -f -- "$file"
    if [ -f "$target" ]; then git add -- "$target"; fi
  done

  local fork_owned both_added conflicts by_claude=""
  fork_owned="$(bash "$here/resolve-fork-owned.sh")"
  both_added="$(bash "$here/resolve-additive-conflicts.sh")"
  conflicts="$(git diff --name-only --diff-filter=U)"

  if [ -n "$conflicts" ]; then
    {
      echo "Resolve the conflicts of the \`git merge upstream/main\` in progress. Ours is the fork's main, theirs is upstream's."
      echo
      echo "$conflicts" | bullets
    } > "$tmp/task"
    local status=0 reason="" marked
    local -a files
    mapfile -t files <<< "$conflicts"
    bash "$here/claude.sh" "$tmp/task" || status=$?
    marked="$(with_markers "${files[@]}")"
    if [ "$status" -eq 3 ]; then
      reason="No Claude credentials are set."
    elif [ "$status" -ne 0 ]; then
      reason="Claude exited with $status."
    elif ! git rev-parse -q --verify MERGE_HEAD > /dev/null; then
      reason="Claude ended the merge itself."
    elif [ -n "$(git diff --name-only --diff-filter=U)" ]; then
      reason="Claude left files unmerged: $(git diff --name-only --diff-filter=U | tr '\n' ' ')"
    elif [ -n "$marked" ]; then
      reason="Claude left conflict markers in: $(echo "$marked" | tr '\n' ' ')"
    fi
    if [ -n "$reason" ]; then
      git merge --abort 2> /dev/null || git reset -q --hard "$start"
      {
        echo "### Upstream merge needs a hand"
        echo
        echo "$reason Merge \`$UPSTREAM\` main locally and push. These files conflict with fork changes:"
        echo
        echo "$conflicts" | bullets
      } >> "$summary"
      echo "::error::Upstream merge conflicts in: $(echo "$conflicts" | tr '\n' ' ')$reason"
      exit 1
    fi
    by_claude="$conflicts"
  fi

  local message body=""
  message="Merge $UPSTREAM main ($(git rev-parse --short upstream/main))"
  section() {
    [ -n "$2" ] || return 0
    body="${body:+$body$'\n\n'}$1"$'\n'"$(echo "$2" | sed 's/^/- /')"
    { echo "### $1"; echo; echo "$2" | bullets; echo; } >> "$summary"
  }
  section "Kept the fork's side of fork-owned files:" "$fork_owned"
  section "Kept both sides where each only added lines:" "$both_added"
  section "Resolved by Claude:" "$by_claude"
  if [ -n "$body" ]; then
    git commit -q --no-edit -m "$message" -m "$body"
  else
    git commit -q --no-edit -m "$message"
  fi
  echo "merged=true" >> "$output"
  git log --oneline -1
}

verify() {
  local cmd="${FORK_VERIFY:-bash $here/verify.sh upstream/main}"
  if bash -c "$cmd" > "$tmp/verify.log" 2>&1; then
    tail -n 20 "$tmp/verify.log"
    return 0
  fi
  cat "$tmp/verify.log"
  {
    echo "The merge commit HEAD fails verification (\`$cmd\`). Fix the code so it passes. Its last output:"
    echo
    echo '```'
    tail -n 200 "$tmp/verify.log"
    echo '```'
  } > "$tmp/task"
  local status=0
  bash "$here/claude.sh" "$tmp/task" || status=$?
  if [ "$status" -eq 0 ] && bash -c "$cmd" > "$tmp/verify.log" 2>&1; then
    git add -A
    if ! git diff --cached --quiet; then
      git commit -q --amend -m "$(git log -1 --format=%B)" -m "Fixed by Claude after verification failed."
    fi
    git log --oneline -1
    return 0
  fi
  {
    echo "### Upstream merge fails verification"
    echo
    [ "$status" -eq 3 ] && echo "No Claude credentials are set." && echo
    echo '```'
    tail -n 60 "$tmp/verify.log"
    echo '```'
  } >> "$summary"
  echo "::error::The upstream merge fails verification; nothing was pushed."
  exit 1
}

case "${1:-}" in
  merge) merge ;;
  verify) verify ;;
  *)
    echo "usage: fork/sync.sh merge|verify" >&2
    exit 2
    ;;
esac
