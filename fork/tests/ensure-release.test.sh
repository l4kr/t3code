#!/usr/bin/env bash
set -u

here="$(cd "$(dirname "$0")" && pwd)"
script="$here/../ensure-release.sh"
failures=0

run_case() {
  local name="$1" state="$2" mirrored="$3" running="$4" expect_enable="$5" expect_dispatch="$6"
  local dir
  dir="$(mktemp -d)"
  mkdir -p "$dir/bin"
  cat > "$dir/bin/gh" <<EOF
#!/usr/bin/env bash
echo "\$*" >> "$dir/calls"
case "\$*" in
  "api repos/l4kr/t3code/actions/workflows/mirror-release.yml --jq .state") echo "$state" ;;
  "api -X PUT repos/l4kr/t3code/actions/workflows/mirror-release.yml/enable") ;;
  "api repos/pingdotgg/t3code/releases/latest --jq .tag_name") echo "v9.9.9" ;;
  "release view v9.9.9 --repo l4kr/t3code") [ "$mirrored" = yes ] || exit 1 ;;
  "run list --repo l4kr/t3code --workflow mirror-release.yml --json status --jq "*) [ "$running" = yes ] && echo 1 || echo 0 ;;
  "workflow run mirror-release.yml --repo l4kr/t3code") ;;
  *) echo "unexpected gh call: \$*" >&2; exit 2 ;;
esac
EOF
  chmod +x "$dir/bin/gh"
  touch "$dir/calls"
  local out status
  out="$(PATH="$dir/bin:$PATH" UPSTREAM=pingdotgg/t3code REPO=l4kr/t3code bash "$script" 2>&1)"
  status=$?
  local enabled=no dispatched=no
  grep -q '/enable$' "$dir/calls" && enabled=yes
  grep -q '^workflow run mirror-release.yml' "$dir/calls" && dispatched=yes
  if [ "$status" -ne 0 ] || [ "$enabled" != "$expect_enable" ] || [ "$dispatched" != "$expect_dispatch" ]; then
    echo "FAIL $name: exit=$status enabled=$enabled dispatched=$dispatched"
    echo "$out" | sed 's/^/    /'
    failures=$((failures + 1))
  else
    echo "ok   $name"
  fi
  rm -rf "$dir"
}

run_case "switched off, release already out: turns it back on" disabled_manually yes no yes no
run_case "switched off, new release: turns it on and builds" disabled_manually no no yes yes
run_case "on, new release: builds it" active no no no yes
run_case "on, new release already building: waits" active no yes no no
run_case "on, release already out: does nothing" active yes no no no

[ "$failures" -eq 0 ]
