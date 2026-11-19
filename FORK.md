# l4kr/t3code

T3 Code for Windows x64, tracking upstream `pingdotgg/t3code`, with:

- Chromium smooth scrolling turned off.
- **Skills** in thread details: _Pick skills_ pins skills as one-click rows. Clicking one sends it.
  Right-click a pinned skill for _Start in background_ (it starts its own thread and leaves you
  where you are) or _Unpin_. Pins live in the browser's local storage.

## Source sync

`.github/workflows/sync-upstream.yml` merges upstream `main` into `main` hourly.

- Upstream's workflows are parked, unchanged, in `fork/upstream-workflows/` so they never run here.
  Git's rename detection carries upstream's edits into them; new ones are moved there on merge.
- Any other conflict stops the run and lists the files in the run summary. Merge locally then.
- Pushing upstream commits that touch workflows needs a `FORK_SYNC_TOKEN` secret: a fine-grained
  token for this repository with **Contents** and **Workflows** read/write.

## Releases

`.github/workflows/mirror-release.yml` runs hourly. For each new stable upstream release it:

1. checks out the upstream tag and applies this fork's changes (`main` minus upstream, excluding
   `.github/`, `fork/` and this file),
2. builds the web client with the T3 Connect config read from upstream's own build
   (`fork/upstream-client-env.mjs`; telemetry tokens are left out),
3. repacks upstream's official installer (`fork/repack-windows.mjs`): swaps in that web client,
   disables smooth scrolling, points the updater at this repo, and rebuilds the NSIS installer,
4. publishes it here with upstream's tag, title and notes, so the installed app updates as usual.

The server, desktop shell and native parts stay upstream's build.

- Fork changes ship with the next upstream release. To get them now, run _Mirror upstream release_
  with _replace_ checked; an installed app on that version needs a manual reinstall.
- Builds are unsigned, so `app-update.yml` has no `publisherName`. Only the first manual install
  shows a SmartScreen prompt.
- Stable channel, x64 only.
- If upstream changes its packaging or client bundle shape, the scripts fail loudly and the app
  stays on the last mirrored version.
