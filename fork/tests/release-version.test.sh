#!/usr/bin/env bash
set -u

here="$(cd "$(dirname "$0")" && pwd)"
FORK_DIR="$(cd "$here/.." && pwd)" node --input-type=module - <<'NODE'
const { latestForkTag, nextRelease } = await import(`${process.env.FORK_DIR}/release-version.mjs`);
let failures = 0;
const check = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `: got ${JSON.stringify(actual)}`}`);
  if (!ok) failures += 1;
};

check(
  "a new upstream version starts at fork build 1",
  nextRelease({ upstreamTag: "v0.1.13", last: null, mainSha: "a" }),
  { version: "0.1.13-l4kr.1", tag: "v0.1.13-l4kr.1" },
);
check(
  "fork changes since the last release bump the fork build",
  nextRelease({ upstreamTag: "v0.1.13", last: { tag: "v0.1.13-l4kr.2", sha: "a" }, mainSha: "b" }),
  { version: "0.1.13-l4kr.3", tag: "v0.1.13-l4kr.3" },
);
check(
  "nothing new since the last release: no release",
  nextRelease({ upstreamTag: "v0.1.13", last: { tag: "v0.1.13-l4kr.2", sha: "a" }, mainSha: "a" }),
  null,
);
check(
  "the last release of an older upstream version does not count",
  nextRelease({ upstreamTag: "v0.1.14", last: { tag: "v0.1.13-l4kr.4", sha: "a" }, mainSha: "a" }),
  { version: "0.1.14-l4kr.1", tag: "v0.1.14-l4kr.1" },
);
check(
  "picks this upstream version's latest fork release from a list",
  latestForkTag("v0.1.13", ["v0.1.13-l4kr.2", "v0.1.13-l4kr.10", "v0.1.12-l4kr.30", "v0.1.13", "nightly"]),
  "v0.1.13-l4kr.10",
);
check("no fork release of this upstream version yet", latestForkTag("v0.1.13", ["v0.1.12-l4kr.1"]), null);
process.exit(failures === 0 ? 0 : 1);
NODE
