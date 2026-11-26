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
- **No telemetry**: product analytics (`ingest.t3.codes`), agent feedback reports, and T3 Connect
  relay traces (Axiom) are cut where they would leave the process: `AnalyticsService.layer` records
  nothing and `RelayTracing.layer` never exports, whatever the environment says. The server, the web
  client, the desktop window and the mobile app all go through those two. Mobile crash reports never
  dispatch and its Diagnostics switches are hidden, though mobile only changes if you build it
  yourself; the store apps are upstream's. Your own OpenTelemetry export in
  _Settings > Maintenance > Diagnostics_ still works. Using T3 Connect still means talking to
  upstream's relay, which keeps its own server-side logs.

## Source sync

`.github/workflows/sync-upstream.yml` merges upstream `main` into `main` hourly with
`fork/sync.sh`. Each step only runs if the one before could not finish:

1. **Rules, no tokens.** Upstream's workflows are parked, unchanged, in `fork/upstream-workflows/`
   so they never run here; git's rename detection carries upstream's edits into them and new ones
   are moved there. In the files listed in `fork/fork-owned.txt` (the telemetry cuts and their
   tests), the fork's side of each conflicting hunk wins and upstream's other hunks stay. A conflict
   where both sides only added lines at the same spot keeps both
   (`fork/resolve-additive-conflicts.sh`).
2. **Claude**, for conflicts the rules leave. It gets `fork/claude-merge.md` and this file, edits the
   working tree, and stages; the script refuses its result if anything is unmerged or still has
   conflict markers, and then nothing is pushed.
3. **Verify, no tokens.** `fork/verify.sh` typechecks every package the fork changes, runs the tests
   of fork-changed files and `fork/tests/`, builds the server and web client, and runs
   `fork/telemetry-guard.mjs`: it fails on a known telemetry SDK in any shipped package's
   dependencies, or a telemetry endpoint, key or exporter in the built bundle. If verification
   fails, Claude gets its output once and its fix is folded into the merge commit; if it still
   fails, nothing is pushed.

The merge commit body and run summary list each file each step settled. Without Claude credentials
the run stops where Claude would start, and the summary lists the files to merge by hand.

- Claude uses the `CLAUDE_CODE_OAUTH_TOKEN` secret (`claude setup-token`, uses a Claude
  subscription) or `ANTHROPIC_API_KEY`, with Opus at high effort and Claude Code's own telemetry
  off. `FORK_CLAUDE_MODEL` and `FORK_CLAUDE_EFFORT` override them.
- When a new fork change replaces a file outright, add it to `fork/fork-owned.txt`.
- Pushes use the `FORK_SYNC_TOKEN` secret, a token with Contents and Workflows write access.
- `bash fork/tests/sync.test.sh` and `bash fork/tests/telemetry-guard.test.sh` test the scripts.

## Releases

`.github/workflows/mirror-release.yml` runs hourly. For each new stable upstream release:

1. **build** (Linux): checks out the upstream tag, applies this fork's changes (`main` minus
   upstream, excluding `.github/`, `fork/` and this file), and builds the server and web client with
   the T3 Connect config read from upstream's own build (`fork/upstream-client-env.mjs`; telemetry
   tokens are left out). If the changes still conflict with the tag after unwinding later upstream
   syncs, the same rules and then Claude resolve them, and the result is typechecked. The telemetry
   guard must pass on the built bundle or nothing is released.
2. **windows**: repacks upstream's installer (`fork/repack-windows.mjs`) with that server, smooth
   scrolling off and the updater pointed at this repo.
3. **macos** (arm64 and x64): repacks upstream's app (`fork/repack-macos.mjs`) with that server,
   updates the asar integrity hash, drops the passkey entitlements tied to upstream's Apple team,
   re-signs with this fork's Developer ID, and notarizes and staples it.
4. **publish**: writes `latest-mac.yml` and publishes everything with upstream's tag, title and notes.

Electron, the desktop shell and native parts stay upstream's builds. A fork change to
`apps/desktop` would not ship.

- Fork changes ship with the next upstream release. To get them now, run _Mirror upstream release_
  with _replace_ checked; an installed app on that version needs a manual reinstall.
- Windows builds are unsigned, so `app-update.yml` has no `publisherName`. Only the first manual
  install shows a SmartScreen prompt.
- macOS secrets: `MAC_CERT_P12_BASE64`, `MAC_CERT_PASSWORD` (Developer ID Application certificate),
  `APPLE_ID`, `APPLE_APP_PASSWORD` (app-specific), `APPLE_TEAM_ID`. The certificate expires in
  December 2027. An app installed from upstream won't update into this fork's signature; install the
  fork once by hand.
- macOS passkeys in the in-app browser are unavailable: their entitlements need upstream's Apple team.
- Stable channel only.
- If upstream changes its packaging or client bundle shape, the scripts fail loudly and the app
  stays on the last mirrored version.

### Keeping releases coming

GitHub runs this repository's schedules hours late or not at all, and the release workflow has been
found switched off more than once. `fork/ensure-release.sh` turns `mirror-release.yml` back on if it
is off, and starts it when upstream's latest stable release isn't released here yet and no run is
going. Two things run it:

- every `Sync upstream source` run, as its last step;
- nikador, every 15 minutes: `fork/release-watch/` holds the systemd user units, run from a sparse
  clone at `~/.cache/l4kr-t3code` with `gh` signed in as l4kr.

`bash fork/tests/ensure-release.test.sh` tests the script.
