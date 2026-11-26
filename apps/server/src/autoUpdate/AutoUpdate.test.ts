import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";
import * as SqlClient from "effect/sql/SqlClient";
import * as TestClock from "effect/testing/TestClock";

import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as AutoUpdate from "./AutoUpdate.ts";

const settle = Effect.gen(function* () {
  for (let i = 0; i < 20; i += 1) yield* Effect.yieldNow;
});

const makeMachine = Effect.fn(function* (input: {
  readonly currentVersion?: string;
  readonly newest?: string | undefined;
  readonly busy?: boolean;
  readonly away?: boolean;
}) {
  const newest = yield* Ref.make(input.newest);
  const busy = yield* Ref.make(input.busy ?? false);
  const away = yield* Ref.make(input.away ?? true);
  const staged = yield* Ref.make<ReadonlyArray<string>>([]);
  const installed = yield* Ref.make<ReadonlyArray<string>>([]);
  const machine: AutoUpdate.AutoUpdateMachine = {
    currentVersion: input.currentVersion ?? "0.1.13-l4kr.1",
    newestVersion: Ref.get(newest),
    busy: Ref.get(busy),
    userAway: Ref.get(away),
    stage: (version) => Ref.update(staged, (all) => [...all, version]),
    install: (version) => Ref.update(installed, (all) => [...all, version]),
  };
  yield* AutoUpdate.runAutoUpdates(machine).pipe(Effect.forkScoped);
  yield* settle;
  return { newest, busy, away, staged, installed };
});

const advance = (duration: Parameters<typeof TestClock.adjust>[0]) =>
  TestClock.adjust(duration).pipe(Effect.andThen(settle));

describe("AutoUpdate.runAutoUpdates", () => {
  it.effect("installs a newer release once nothing has run for two minutes", () =>
    Effect.gen(function* () {
      const machine = yield* makeMachine({ newest: "0.1.13-l4kr.2" });
      yield* advance("1 minute");
      expect(yield* Ref.get(machine.installed)).toEqual([]);
      yield* advance("2 minutes");
      expect(yield* Ref.get(machine.installed)).toEqual(["0.1.13-l4kr.2"]);
    }),
  );

  it.effect("downloads right away but waits to install until the work finishes", () =>
    Effect.gen(function* () {
      const machine = yield* makeMachine({ newest: "0.1.14-l4kr.1", busy: true });
      expect(yield* Ref.get(machine.staged)).toEqual(["0.1.14-l4kr.1"]);
      yield* advance("45 minutes");
      expect(yield* Ref.get(machine.installed)).toEqual([]);

      yield* Ref.set(machine.busy, false);
      yield* advance("1 minute");
      yield* Ref.set(machine.busy, true);
      yield* advance("5 minutes");
      expect(yield* Ref.get(machine.installed)).toEqual([]);

      yield* Ref.set(machine.busy, false);
      yield* advance("3 minutes");
      expect(yield* Ref.get(machine.installed)).toEqual(["0.1.14-l4kr.1"]);
    }),
  );

  it.effect("waits for the user to step away before restarting the app", () =>
    Effect.gen(function* () {
      const machine = yield* makeMachine({ newest: "0.1.13-l4kr.2", away: false });
      yield* advance("30 minutes");
      expect(yield* Ref.get(machine.installed)).toEqual([]);
      yield* Ref.set(machine.away, true);
      yield* advance("3 minutes");
      expect(yield* Ref.get(machine.installed)).toEqual(["0.1.13-l4kr.2"]);
    }),
  );

  it.effect("leaves a machine already on the newest release alone", () =>
    Effect.gen(function* () {
      const same = yield* makeMachine({ newest: "0.1.13-l4kr.1" });
      const older = yield* makeMachine({ newest: "0.1.12-l4kr.4" });
      const unknown = yield* makeMachine({ newest: undefined });
      yield* advance("3 hours");
      for (const machine of [same, older, unknown]) {
        expect(yield* Ref.get(machine.staged)).toEqual([]);
        expect(yield* Ref.get(machine.installed)).toEqual([]);
      }
    }),
  );

  it.effect("picks up a release published later", () =>
    Effect.gen(function* () {
      const machine = yield* makeMachine({ newest: "0.1.13-l4kr.1" });
      yield* advance("10 minutes");
      yield* Ref.set(machine.newest, "0.1.14-l4kr.1");
      yield* advance("1 hour");
      yield* advance("3 minutes");
      expect(yield* Ref.get(machine.installed)).toEqual(["0.1.14-l4kr.1"]);
    }),
  );
});

describe("AutoUpdate.terminalsBusy", () => {
  const summary = (terminalId: string, hasRunningSubprocess: boolean, status = "running") => ({
    threadId: "thread-1",
    terminalId,
    cwd: "/tmp",
    worktreePath: null,
    status: status as "running",
    pid: 42,
    exitCode: null,
    exitSignal: null,
    hasRunningSubprocess,
    label: terminalId,
    updatedAt: "2026-11-26T00:00:00.000Z",
  });

  it("counts a terminal with a command still running, not an idle shell", () => {
    let terminals = AutoUpdate.applyTerminalEvent(new Map(), {
      type: "snapshot",
      terminals: [summary("idle-shell", false), summary("dev-server", true)],
    });
    expect(AutoUpdate.terminalsBusy(terminals)).toBe(true);

    terminals = AutoUpdate.applyTerminalEvent(terminals, {
      type: "upsert",
      terminal: summary("dev-server", false),
    });
    expect(AutoUpdate.terminalsBusy(terminals)).toBe(false);

    terminals = AutoUpdate.applyTerminalEvent(terminals, {
      type: "upsert",
      terminal: summary("build", true),
    });
    expect(AutoUpdate.terminalsBusy(terminals)).toBe(true);

    terminals = AutoUpdate.applyTerminalEvent(terminals, {
      type: "remove",
      threadId: "thread-1",
      terminalId: "build",
    });
    expect(AutoUpdate.terminalsBusy(terminals)).toBe(false);
  });
});

describe("AutoUpdate.userAway", () => {
  const power = (overrides: Partial<Parameters<typeof AutoUpdate.userAwayFrom>[0]>) => ({
    idleSeconds: 0,
    locked: "false" as const,
    stale: false,
    ...overrides,
  });

  it("is away after five idle minutes or on a locked screen, not while in use", () => {
    expect(AutoUpdate.userAwayFrom(power({ idleSeconds: 30 }))).toBe(false);
    expect(AutoUpdate.userAwayFrom(power({ idleSeconds: 300 }))).toBe(true);
    expect(AutoUpdate.userAwayFrom(power({ locked: "true" }))).toBe(true);
    expect(AutoUpdate.userAwayFrom(power({ idleSeconds: null }))).toBe(false);
    expect(AutoUpdate.userAwayFrom(power({ idleSeconds: 900, stale: true }))).toBe(false);
  });
});

it.layer(SqlitePersistence.layerMemory)("AutoUpdate.workInProgress", (it) => {
  it.effect("is busy while a run, a workflow step or a scheduled task is still going", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const now = "2026-11-26T00:00:00.000Z";
      expect(yield* AutoUpdate.workInProgress).toBe(false);

      const run = (runId: string, status: string) => sql`
        INSERT INTO orchestration_v2_projection_runs
          (run_id, thread_id, ordinal, provider, status, requested_at, payload_json)
        VALUES (${runId}, ${`thread-${runId}`}, 1, 'codex', ${status}, ${now}, '{}')
      `;
      yield* run("done", "completed");
      expect(yield* AutoUpdate.workInProgress).toBe(false);
      for (const status of ["queued", "preparing", "starting", "running", "waiting"]) {
        yield* run(status, status);
        expect(yield* AutoUpdate.workInProgress).toBe(true);
        yield* sql`UPDATE orchestration_v2_projection_runs SET status = 'completed' WHERE run_id = ${status}`;
        expect(yield* AutoUpdate.workInProgress).toBe(false);
      }

      yield* sql`
        INSERT INTO workflow_runs
          (run_id, workflow, version, engine_tag, idempotency_key, title, status, started_at, updated_at)
        VALUES ('wf', 'release', 1, 'engine', 'key', 'Release', 'running', ${now}, ${now})
      `;
      expect(yield* AutoUpdate.workInProgress).toBe(true);
      yield* sql`UPDATE workflow_runs SET status = 'completed' WHERE run_id = 'wf'`;
      expect(yield* AutoUpdate.workInProgress).toBe(false);

      yield* sql`
        INSERT INTO scheduled_tasks
          (task_id, title, prompt, enabled, schedule_json, project_id, workspace_strategy_json,
           model_selection_json, runtime_mode, interaction_mode, created_by, creation_source,
           created_at, updated_at, last_run_status, run_count)
        VALUES ('task', 'Nightly', 'go', 1, '{}', 'project', '{}', '{}', 'full-access', 'default',
          'user', 'user', ${now}, ${now}, 'running', 0)
      `;
      expect(yield* AutoUpdate.workInProgress).toBe(true);
      yield* sql`UPDATE scheduled_tasks SET last_run_status = 'succeeded' WHERE task_id = 'task'`;
      expect(yield* AutoUpdate.workInProgress).toBe(false);
    }),
  );
});
