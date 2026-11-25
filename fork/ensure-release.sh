#!/usr/bin/env bash
set -euo pipefail

UPSTREAM="${UPSTREAM:-pingdotgg/t3code}"
REPO="${REPO:-${GITHUB_REPOSITORY:-l4kr/t3code}}"
WORKFLOW=mirror-release.yml

state="$(gh api "repos/$REPO/actions/workflows/$WORKFLOW" --jq .state)"
if [ "$state" != active ]; then
  gh api -X PUT "repos/$REPO/actions/workflows/$WORKFLOW/enable"
  echo "Turned $WORKFLOW back on (it was $state)."
fi

tag="$(gh api "repos/$UPSTREAM/releases/latest" --jq .tag_name)"
if gh release view "$tag" --repo "$REPO" > /dev/null 2>&1; then
  echo "$tag is already released on $REPO."
  exit 0
fi

pending="$(gh run list --repo "$REPO" --workflow "$WORKFLOW" --json status --jq '[.[] | select(.status != "completed")] | length')"
if [ "$pending" != 0 ]; then
  echo "$tag is not released yet; a $WORKFLOW run is already going."
  exit 0
fi

gh workflow run "$WORKFLOW" --repo "$REPO"
echo "Started $WORKFLOW for $tag."
