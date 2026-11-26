# l4kr/t3code

T3 Code for Windows x64 and macOS (Apple Silicon and Intel), tracking upstream `pingdotgg/t3code`, with:

- **Skills** in thread details: _Pick skills_ pins skills as one-click rows. Clicking one sends it.
  Right-click a pinned skill for _Start in background_ (it starts its own thread and opens the top
  unpinned thread) or _Unpin_. Pins live in the browser's local storage.
  Pinned skills show names in sentence case and an `icon.png` from beside the skill's `SKILL.md`;
  _Change icon_ in the right-click menu overrides it for that browser, and _Reset icon_ drops that.
- **`t3 skills rescan`**: the running app rescans skills in every workspace it holds and tells open
  windows to reload them, icons included. Lstack's `sync.py` runs it after each sync.
- **Codex accounts**: each shadow home keeps its own `auth.json.lock`, so newer Codex CLIs no longer
  stop extra accounts from starting.
- **Branch cleanup**: when storage cleanup removes a settled thread's worktree, it also deletes the
  thread's branch if every commit is on the default branch or its pull request merged.
- Windows only: Chromium smooth scrolling turned off.
- **Browser and device windows**: a browser tab or a simulator opens in its own window instead of
  the right panel or the floating player, and opening it again brings that window forward. The
  panel keeps its tabs as launchers. Closing the window hands a browser tab back to the main window,
  hidden, so agents keep using it; the page reloads when it moves. Annotations made there land in
  the thread's composer in the main window, and _Send_ brings that thread forward to send. On the
  web, a window the browser blocks (one an agent opens) falls back to the panel or floating player.
- **No telemetry**. Nothing is sent to `ingest.t3.codes`: `AnalyticsService.layer` records nothing,
  whatever the environment says. Agent feedback is gone: the server keeps its mode off, so agents get
  no feedback tools or instructions, Labs no longer offers it, and `t3 feedback` is removed. T3
  Connect relay traces (Axiom) never export: the server, web client, desktop window and mobile app
  all go through `RelayTracing.layer`. Clerk, which signs in to T3 Connect, gets `telemetry={false}`
  at every `<ClerkProvider>`. Mobile crash reports never dispatch; the mobile switches stay but send
  nothing, and mobile only changes if you build it yourself. The usage-data notices on the Welcome
  page and in Settings are gone. Using T3 Connect still means talking to upstream's relay, which
  keeps its own logs.

## Releases

Everything runs on GitHub. `.github/workflows/mirror-release.yml` runs hourly and on every push to
`main`. It releases when upstream has a new stable version, or when `main` changed since the last
release, as `<upstream version>-l4kr.<n>` (`fork/release-version.mjs`): `v0.1.12-l4kr.1`,
`v0.1.12-l4kr.2` for a fork change, `v0.1.13-l4kr.1` for the next upstream version. Installed apps
and `t3 update` take each one, since T3 reads the suffix as the stable channel; macOS keeps
upstream's numeric bundle version. Each step runs only if the one before could not finish:

1. **Rules, no tokens.** `fork/sync.sh merge` merges the upstream version's tag into `main`.
   Upstream's workflows are parked, unchanged, in `fork/upstream-workflows/` so they never run here;
   git's rename detection carries upstream's edits into them and new ones are moved there. In the
   files listed in `fork/fork-owned.txt` (the telemetry cuts and their tests), the fork's side of each
   conflicting hunk wins and upstream's other hunks stay. A conflict where both sides only added
   lines at the same spot keeps both (`fork/resolve-additive-conflicts.sh`).
2. **Claude**, for conflicts the rules leave. It gets `fork/claude-merge.md` and this file, edits the
   working tree, and stages; the script refuses its result if anything is unmerged or still has
   conflict markers, and then nothing is pushed.
3. **Verify, no tokens.** `fork/sync.sh verify` runs `fork/verify.sh`: it typechecks every package
   the fork changes, runs the tests of fork-changed files and `fork/tests/`, builds the server, web
   client and desktop main process, and runs `fork/telemetry-guard.mjs`. The guard fails on a known
   telemetry SDK in any shipped package's dependencies, a `<ClerkProvider>` without
   `telemetry={false}` (Clerk loads its reporting code from its own servers, so no bundle scan sees
   it), or a telemetry endpoint or exporter in the built bundle. If verification fails, Claude gets
   its output once and its fix is folded into the merge commit; if it still fails, nothing is pushed
   or released.
4. **Ship.** `main` is pushed and its build is released:
   - **windows**: repacks upstream's installer (`fork/repack-windows.mjs`) with the fork's server
     and desktop main process, smooth scrolling off and the updater pointed at this repo.
   - **macos** (arm64 and x64): repacks upstream's app (`fork/repack-macos.mjs`) the same way,
     updates the asar integrity hash, drops the passkey entitlements tied to upstream's Apple team,
     re-signs with this fork's Developer ID, and notarizes and staples it.
   - **cli** (linux x64 and arm64, macOS arm64, Windows x64 and arm64, each on its own runner):
     builds the standalone `t3` runtime that `t3 serve`, the background service and SSH installs
     use, with upstream's `scripts/build-cli-archive.ts`, and smoke-tests it. `t3 update` and SSH
     installs download from this repo's releases.
   - **publish**: writes `latest-mac.yml` and `SHA256SUMS` and publishes everything with upstream's
     tag, title and notes.

The merge commit body and run summary list each file each step settled. A failed run leaves `main`
and the last release as they were, and GitHub emails the failure.

- The server and web client build with the T3 Connect config read from upstream's own build
  (`fork/upstream-client-env.mjs`; telemetry tokens are left out). The desktop main process
  (`apps/desktop/dist-electron`) is built from fork source and swapped in (`fork/desktop-dist.mjs`);
  Electron and native parts stay upstream's builds. The swap fails loudly if the fork's build lacks
  an entry upstream ships or loads a module the app doesn't ship.
- Claude uses the `CLAUDE_CODE_OAUTH_TOKEN` secret (`claude setup-token`, uses a Claude
  subscription) or `ANTHROPIC_API_KEY`, with Opus at high effort and Claude Code's own telemetry
  off. `FORK_CLAUDE_MODEL` and `FORK_CLAUDE_EFFORT` override them. Without either, the run stops
  where Claude would start, and the summary lists the files to merge by hand.
- When a new fork change replaces a file outright, add it to `fork/fork-owned.txt`.
- Pushes use the `FORK_SYNC_TOKEN` secret, a token with Contents and Workflows write access.
- Each run re-enables the workflow, since GitHub switches off schedules on quiet repositories.
- Windows builds are unsigned, so `app-update.yml` has no `publisherName`. Only the first manual
  install shows a SmartScreen prompt.
- macOS secrets: `MAC_CERT_P12_BASE64`, `MAC_CERT_PASSWORD` (Developer ID Application certificate),
  `APPLE_ID`, `APPLE_APP_PASSWORD` (app-specific), `APPLE_TEAM_ID`. The certificate expires in
  December 2027. An app installed from upstream won't update into this fork's signature; install the
  fork once by hand.
- macOS passkeys in the in-app browser are unavailable: their entitlements need upstream's Apple team.
- Stable channel only.
- `bash fork/tests/sync.test.sh`, `bash fork/tests/telemetry-guard.test.sh` and
  `bash fork/tests/desktop-dist.test.sh` test the scripts.
