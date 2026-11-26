#!/usr/bin/env bash
set -u

here="$(cd "$(dirname "$0")" && pwd)"
fork_dir="$(cd "$here/.." && pwd)"
failures=0
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

export GIT_AUTHOR_NAME=test GIT_AUTHOR_EMAIL=test@example.com
export GIT_COMMITTER_NAME=test GIT_COMMITTER_EMAIL=test@example.com
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
unset CLAUDE_CODE_OAUTH_TOKEN ANTHROPIC_API_KEY GITHUB_STEP_SUMMARY GITHUB_OUTPUT UPSTREAM UPSTREAM_REF UPSTREAM_URL FORK_VERIFY CLAUDE_BIN

fail() {
  echo "FAIL $1"
  [ -f "$case_dir/out" ] && sed 's/^/    /' "$case_dir/out"
  failures=$((failures + 1))
}
ok() { echo "ok   $1"; }

lines() { printf '%s\n' "$@"; }

# upstream: one repo with history; fork: a clone with fork/ tooling and its own edits.
setup() {
  case_dir="$work/$1"
  mkdir -p "$case_dir/upstream" "$case_dir/bin"
  git -C "$case_dir/upstream" init -q -b main
  (
    cd "$case_dir/upstream"
    mkdir -p src .github/workflows
    lines one two three four five six seven eight > src/app.ts
    lines "send(1)" "send(2)" keep-a keep-b keep-c keep-d keep-e keep-f "tail" > src/telemetry.ts
    lines "name: ci" > .github/workflows/ci.yml
    git add -A && git commit -qm "upstream base"
  )
  git clone -q "$case_dir/upstream" "$case_dir/fork"
  (
    cd "$case_dir/fork"
    mkdir -p fork/upstream-workflows
    cp "$fork_dir"/sync.sh "$fork_dir"/claude.sh "$fork_dir"/claude-merge.md \
      "$fork_dir"/resolve-fork-owned.sh "$fork_dir"/resolve-additive-conflicts.sh fork/
    lines "# test" src/telemetry.ts > fork/fork-owned.txt
    git mv .github/workflows/ci.yml fork/upstream-workflows/ci.yml
    lines "noop(1)" "noop(2)" keep-a keep-b keep-c keep-d keep-e keep-f "tail" > src/telemetry.ts
    lines one two three FORK five six seven eight > src/app.ts
    echo "# fork" > FORK.md
    git add -A && git commit -qm "fork changes"
  )
  printf '#!/usr/bin/env bash\necho call >> "%s/claude-calls"\n%s\n' "$case_dir" "${2:-exit 0}" \
    > "$case_dir/bin/claude"
  chmod +x "$case_dir/bin/claude"
  touch "$case_dir/claude-calls"
}

upstream() { (cd "$case_dir/upstream" && "$@" && git add -A && git commit -qm "upstream change"); }

sync() {
  (
    cd "$case_dir/fork"
    UPSTREAM_URL="$case_dir/upstream" GITHUB_STEP_SUMMARY="$case_dir/summary" \
      GITHUB_OUTPUT="$case_dir/output" PATH="$case_dir/bin:$PATH" "$@" bash fork/sync.sh "${SYNC_STEP:-merge}"
  ) > "$case_dir/out" 2>&1
}

claude_calls() { wc -l < "$case_dir/claude-calls" | tr -d ' '; }
head_subject() { git -C "$case_dir/fork" log -1 --format=%s; }
is_merge() { git -C "$case_dir/fork" rev-parse -q --verify HEAD^2 > /dev/null; }

name="up to date: does nothing"
setup uptodate
before="$(git -C "$case_dir/fork" rev-parse HEAD)"
sync env
if [ $? -eq 0 ] && [ "$(git -C "$case_dir/fork" rev-parse HEAD)" = "$before" ] && ! grep -q merged=true "$case_dir/output" 2> /dev/null; then ok "$name"; else fail "$name"; fi

name="unrelated upstream change: merges with no Claude call"
setup clean
upstream sh -c 'echo nine >> src/app.ts'
sync env CLAUDE_BIN="$case_dir/bin/claude"
if [ $? -eq 0 ] && is_merge && [ "$(claude_calls)" = 0 ] && grep -q merged=true "$case_dir/output" \
  && head_subject | grep -Eq '^Merge pingdotgg/t3code main \([0-9a-f]+\)$' \
  && grep -q FORK "$case_dir/fork/src/app.ts" && grep -q nine "$case_dir/fork/src/app.ts"; then ok "$name"; else fail "$name"; fi

name="upstream edits fork-owned code: fork's version wins, upstream's other hunks stay, no Claude call"
setup owned
upstream sh -c 'printf "%s\n" "send(1, extra)" "send(2)" keep-a keep-b keep-c keep-d keep-e keep-f "tail-upstream" > src/telemetry.ts'
sync env CLAUDE_BIN="$case_dir/bin/claude"
t="$case_dir/fork/src/telemetry.ts"
if [ $? -eq 0 ] && is_merge && [ "$(claude_calls)" = 0 ] && grep -qx 'noop(1)' "$t" && ! grep -q send "$t" \
  && grep -qx tail-upstream "$t" && git -C "$case_dir/fork" log -1 --format=%b | grep -q 'src/telemetry.ts'; then ok "$name"; else fail "$name"; fi

name="a release tag: merges that version, not upstream main past it, with no Claude call"
setup tag
upstream sh -c 'echo nine >> src/app.ts && git add -A && git commit -qm release && git tag v1.2.3 && echo ten >> src/app.ts'
sync env CLAUDE_BIN="$case_dir/bin/claude" UPSTREAM_REF=refs/tags/v1.2.3
a="$case_dir/fork/src/app.ts"
if [ $? -eq 0 ] && is_merge && [ "$(claude_calls)" = 0 ] && [ "$(head_subject)" = "Merge pingdotgg/t3code v1.2.3" ] \
  && grep -qx nine "$a" && ! grep -qx ten "$a" && grep -qx FORK "$a"; then ok "$name"; else fail "$name"; fi

name="a release tag main already has: does nothing"
SYNC_STEP=merge sync env UPSTREAM_REF=refs/tags/v1.2.3
if [ $? -eq 0 ] && [ "$(head_subject)" = "Merge pingdotgg/t3code v1.2.3" ]; then ok "$name"; else fail "$name"; fi

name="new upstream workflow: parked under fork/upstream-workflows"
setup workflow
upstream sh -c 'echo "name: new" > .github/workflows/new.yml'
sync env
if [ $? -eq 0 ] && [ -f "$case_dir/fork/fork/upstream-workflows/new.yml" ] && [ ! -e "$case_dir/fork/.github/workflows/new.yml" ]; then ok "$name"; else fail "$name"; fi

name="real conflict without Claude credentials: stops, main unchanged, summary lists the file"
setup nocreds
upstream sh -c 'printf "%s\n" one two three UPSTREAM five six seven eight > src/app.ts'
before="$(git -C "$case_dir/fork" rev-parse HEAD)"
sync env
status=$?
if [ "$status" -ne 0 ] && [ "$(git -C "$case_dir/fork" rev-parse HEAD)" = "$before" ] \
  && [ -z "$(git -C "$case_dir/fork" status --porcelain)" ] && grep -q 'src/app.ts' "$case_dir/summary"; then ok "$name"; else fail "$name"; fi

name="real conflict: Claude resolves it, the merge records that"
setup claude 'printf "%s\n" one two three FORK UPSTREAM five six seven eight > src/app.ts && git add src/app.ts'
upstream sh -c 'printf "%s\n" one two three UPSTREAM five six seven eight > src/app.ts'
sync env CLAUDE_BIN="$case_dir/bin/claude"
if [ $? -eq 0 ] && is_merge && [ "$(claude_calls)" = 1 ] && grep -qx FORK "$case_dir/fork/src/app.ts" \
  && grep -qx UPSTREAM "$case_dir/fork/src/app.ts" \
  && git -C "$case_dir/fork" log -1 --format=%b | grep -q 'Resolved by Claude' \
  && git -C "$case_dir/fork" log -1 --format=%b | grep -q 'src/app.ts'; then ok "$name"; else fail "$name"; fi

name="Claude leaves conflict markers: stops, main unchanged"
setup markers 'git add src/app.ts'
upstream sh -c 'printf "%s\n" one two three UPSTREAM five six seven eight > src/app.ts'
before="$(git -C "$case_dir/fork" rev-parse HEAD)"
sync env CLAUDE_BIN="$case_dir/bin/claude"
if [ $? -ne 0 ] && [ "$(git -C "$case_dir/fork" rev-parse HEAD)" = "$before" ] \
  && [ -z "$(git -C "$case_dir/fork" status --porcelain)" ]; then ok "$name"; else fail "$name"; fi

name="verification passes: no Claude call"
setup verify-pass
upstream sh -c 'echo nine >> src/app.ts'
sync env
merge="$(git -C "$case_dir/fork" rev-parse HEAD)"
SYNC_STEP=verify sync env CLAUDE_BIN="$case_dir/bin/claude" FORK_VERIFY=true
if [ $? -eq 0 ] && [ "$(claude_calls)" = 0 ] && [ "$(git -C "$case_dir/fork" rev-parse HEAD)" = "$merge" ]; then ok "$name"; else fail "$name"; fi

name="verification fails, Claude fixes it: folded into the same merge commit"
setup verify-fix 'echo fixed > fixed.txt'
upstream sh -c 'echo nine >> src/app.ts'
sync env
subject="$(head_subject)"
SYNC_STEP=verify sync env CLAUDE_BIN="$case_dir/bin/claude" FORK_VERIFY='test -f fixed.txt'
if [ $? -eq 0 ] && [ "$(claude_calls)" = 1 ] && is_merge && [ "$(head_subject)" = "$subject" ] \
  && git -C "$case_dir/fork" cat-file -e HEAD:fixed.txt \
  && git -C "$case_dir/fork" log -1 --format=%b | grep -q 'Fixed by Claude'; then ok "$name"; else fail "$name"; fi

name="verification still fails after Claude: stops"
setup verify-stuck
upstream sh -c 'echo nine >> src/app.ts'
sync env
SYNC_STEP=verify sync env CLAUDE_BIN="$case_dir/bin/claude" FORK_VERIFY=false
if [ $? -ne 0 ] && [ "$(claude_calls)" = 1 ] && grep -qi 'verification' "$case_dir/summary"; then ok "$name"; else fail "$name"; fi

[ "$failures" -eq 0 ]
