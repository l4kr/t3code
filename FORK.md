# l4kr/t3code

Official T3 Code for Windows x64, with Chromium smooth scrolling turned off.

## How it works

- `.github/workflows/mirror-release.yml` runs hourly. When `pingdotgg/t3code` publishes a new
  stable release, it downloads the official `T3-Code-<version>-x64.exe` and runs
  `fork/repack-windows.mjs`, which:
  1. unpacks the app from the installer,
  2. prepends `app.commandLine.appendSwitch("disable-smooth-scrolling")` to the Electron entry
     inside `app.asar`,
  3. rewrites `resources/app-update.yml` so the updater reads **this** repo's releases,
  4. rebuilds the NSIS installer with upstream's electron-builder version, NSIS include, icon and
     `app-builder-lib` patch, all fetched from the release tag.
- The workflow publishes the installer, blockmap and `latest.yml` as a release here with the same tag,
  title and notes as upstream. The installed app sees it and updates as usual.

Nothing is rebuilt from source; every other byte of the app is upstream's build.

## Notes

- Upstream's workflows are removed from this branch so they don't run in the fork.
- Builds are unsigned, so `app-update.yml` has no `publisherName` (electron-updater then skips
  signature checks). Only the first manual install shows a SmartScreen prompt.
- Stable channel, x64 only. Switching the app to the nightly channel finds no updates here.
- If upstream changes its packaging (app ID, icon path, builder patch), the script fails loudly and
  the app stays on the last mirrored version until `fork/repack-windows.mjs` is updated.
- Rebuild a specific tag: Actions -> Mirror upstream release -> Run workflow -> tag.
