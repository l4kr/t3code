#!/usr/bin/env bash
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
task="$1"

if [ -z "${CLAUDE_BIN:-}" ] && [ -z "${CLAUDE_CODE_OAUTH_TOKEN:-}" ] && [ -z "${ANTHROPIC_API_KEY:-}" ]; then
  echo "No CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY secret, so this needs a person." >&2
  exit 3
fi

bin="${CLAUDE_BIN:-claude}"
if ! command -v "$bin" > /dev/null; then
  npm install -g --silent --no-fund --no-audit @anthropic-ai/claude-code > /dev/null
fi

fork_md="$here/FORK.md"
[ -f "$fork_md" ] || fork_md="$here/../FORK.md"

prompt="$(cat "$here/claude-merge.md" "$fork_md" 2> /dev/null; printf '\n## Task\n\n'; cat "$task")"

DISABLE_TELEMETRY=1 DISABLE_ERROR_REPORTING=1 CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 \
  "$bin" -p "$prompt" \
  --model "${FORK_CLAUDE_MODEL:-claude-opus-5-5}" \
  --effort "${FORK_CLAUDE_EFFORT:-high}" \
  --dangerously-skip-permissions \
  --output-format text
