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

## Source sync

`.github/workflows/sync-upstream.yml` merges upstream `main` into `main` hourly.

- Upstream's workflows are parked, unchanged, in `fork/upstream-workflows/` so they never run here.
  Git's rename detection carries upstream's edits into them; new ones are moved there on merge.
- A conflict where both sides only added lines at the same spot keeps both
  (`fork/resolve-additive-conflicts.sh`); the merge commit and run summary list those files.
- Any other conflict stops the run and lists the files in the run summary. Merge locally then.
- Pushes use the `FORK_SYNC_TOKEN` secret, a token with Contents and Workflows write access.

## Releases

`.github/workflows/mirror-release.yml` runs hourly. For each new stable upstream release:

1. **build** (Linux): checks out the upstream tag, applies this fork's changes (`main` minus
   upstream, excluding `.github/`, `fork/` and this file), and builds the server and web client with
   the T3 Connect config read from upstream's own build (`fork/upstream-client-env.mjs`; telemetry
   tokens are left out).
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
