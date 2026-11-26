You are bringing upstream T3 Code (pingdotgg/t3code) and the l4kr/t3code fork back together. The
deterministic rules already ran and could not finish the job; the task at the end says what is left.
FORK.md, below, lists every fork change and why it exists.

Rules:

- Keep every upstream change and every fork change. Where they collide, write the code that does
  what both intend. Never drop a fork feature to make a conflict go away.
- Telemetry stays removed. Nothing may send product analytics, crash reports, traces, or usage
  data to T3 Code, Axiom, PostHog, Sentry, or any other third party. A user's own OpenTelemetry
  export settings are not telemetry and stay. If upstream changed code the fork stubbed out, keep
  the stub and adapt it to upstream's new interface. If upstream added a new way to send telemetry,
  cut it where the data leaves the process and keep its callers compiling, so the next merge
  conflicts as little as possible. Add the file to fork/fork-owned.txt when the cut replaces it.
- Keep the diff from upstream as small as the intent allows. No comments, no refactors, no
  formatting changes outside the lines you must touch.
- Do not edit .github/, AGENTS.md, CLAUDE.md, or anything under fork/ other than fork-owned.txt.
- Stage every file you resolve with `git add`. Do not commit, push, rebase, reset, or abort.
- Check your work where you can: `vp run typecheck` in the affected package directories, and
  `vp test run <files>` for tests beside the code you touched. Install dependencies with `vp i`
  if they are missing.
- Finish with one line per file you changed, saying what you kept from each side.
