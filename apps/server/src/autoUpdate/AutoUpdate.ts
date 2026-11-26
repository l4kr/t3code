import type {
  HostPowerSnapshot,
  ServerSelfUpdateError,
  TerminalMetadataStreamEvent,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import {
  cliReleaseChannelOf,
  cliReleaseIndexPageUrl,
  newestCliReleaseVersion,
} from "@t3tools/shared/cliRelease";
import { compareSemverVersions } from "@t3tools/shared/semver";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";

import packageJson from "../../package.json" with { type: "json" };
import * as HostPowerMonitor from "../background/HostPowerMonitor.ts";
import * as ServerSelfUpdate from "../cloud/selfUpdate.ts";
import * as ServiceLauncherClient from "../cloud/serviceLauncherClient.ts";
import * as ServerConfig from "../config.ts";
import { forkParked } from "../serverActivation.ts";
import * as TerminalManager from "../terminal/Manager.ts";

const STARTUP_DELAY = Duration.minutes(2);
const CHECK_INTERVAL = Duration.hours(1);
const IDLE_POLL = Duration.seconds(30);
const FREE_POLLS_BEFORE_INSTALL = 5;
const POLLS_PER_CHECK = Math.round(
  Duration.toMillis(CHECK_INTERVAL) / Duration.toMillis(IDLE_POLL),
);
const AWAY_AFTER_SECONDS = 300;
const RELEASE_INDEX_TIMEOUT = Duration.seconds(30);

export interface AutoUpdateMachine {
  readonly currentVersion: string;
  readonly newestVersion: Effect.Effect<string | undefined>;
  readonly busy: Effect.Effect<boolean>;
  readonly userAway: Effect.Effect<boolean>;
  readonly stage: (version: string) => Effect.Effect<void, ServerSelfUpdateError>;
  readonly install: (version: string) => Effect.Effect<void, ServerSelfUpdateError>;
}

const isNewer = (candidate: string, current: string) =>
  compareSemverVersions(candidate, current) > 0 &&
  cliReleaseChannelOf(candidate) === cliReleaseChannelOf(current);

const logFailure = (message: string, version: string) => (cause: unknown) =>
  Effect.logWarning(message, { version, cause });

const installWhenFree = Effect.fn("AutoUpdate.installWhenFree")(function* (
  machine: AutoUpdateMachine,
  version: string,
) {
  let freePolls = 0;
  for (let poll = 0; poll < POLLS_PER_CHECK; poll += 1) {
    const free = !(yield* machine.busy) && (yield* machine.userAway);
    freePolls = free ? freePolls + 1 : 0;
    if (freePolls >= FREE_POLLS_BEFORE_INSTALL) {
      yield* Effect.logInfo("Installing an update while nothing is running.", { version });
      return yield* machine.install(version).pipe(
        Effect.as("installed" as const),
        Effect.catchCause((cause) =>
          logFailure(
            "The automatic update did not install.",
            version,
          )(cause).pipe(Effect.as("failed" as const)),
        ),
      );
    }
    yield* Effect.sleep(IDLE_POLL);
  }
  return "waiting" as const;
});

export const runAutoUpdates = Effect.fn("AutoUpdate.run")(function* (machine: AutoUpdateMachine) {
  let staged: string | undefined;
  while (true) {
    const newest = yield* machine.newestVersion;
    if (newest === undefined || !isNewer(newest, machine.currentVersion)) {
      yield* Effect.sleep(CHECK_INTERVAL);
      continue;
    }
    if (staged !== newest) {
      staged = newest;
      yield* machine
        .stage(newest)
        .pipe(
          Effect.catchCause(logFailure("Could not download the update ahead of time.", newest)),
        );
    }
    const outcome = yield* installWhenFree(machine, newest);
    if (outcome === "installed") return;
    if (outcome === "failed") yield* Effect.sleep(CHECK_INTERVAL);
  }
});

export type TerminalActivity = ReadonlyMap<string, boolean>;

const terminalKey = (threadId: string, terminalId: string) => `${threadId}\u0000${terminalId}`;

export function applyTerminalEvent(
  terminals: TerminalActivity,
  event: TerminalMetadataStreamEvent,
): TerminalActivity {
  const running = (terminal: { readonly status: string; readonly hasRunningSubprocess: boolean }) =>
    terminal.status === "running" && terminal.hasRunningSubprocess;
  switch (event.type) {
    case "snapshot":
      return new Map(
        event.terminals.map((terminal) => [
          terminalKey(terminal.threadId, terminal.terminalId),
          running(terminal),
        ]),
      );
    case "upsert": {
      const next = new Map(terminals);
      next.set(
        terminalKey(event.terminal.threadId, event.terminal.terminalId),
        running(event.terminal),
      );
      return next;
    }
    case "remove": {
      const next = new Map(terminals);
      next.delete(terminalKey(event.threadId, event.terminalId));
      return next;
    }
  }
}

export const terminalsBusy = (terminals: TerminalActivity) =>
  [...terminals.values()].some((running) => running);

export const userAwayFrom = (power: Pick<HostPowerSnapshot, "idleSeconds" | "locked" | "stale">) =>
  !power.stale &&
  (power.locked === "true" ||
    (power.idleSeconds !== null && power.idleSeconds >= AWAY_AFTER_SECONDS));

export const workInProgress = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<{ readonly busy: number }>`
    SELECT (
      EXISTS (
        SELECT 1 FROM orchestration_v2_projection_runs
        WHERE status IN ('queued', 'preparing', 'starting', 'running', 'waiting')
      )
      OR EXISTS (SELECT 1 FROM workflow_runs WHERE status = 'running')
      OR EXISTS (SELECT 1 FROM scheduled_tasks WHERE last_run_status = 'running')
      OR EXISTS (SELECT 1 FROM orchestration_v2_effect_outbox WHERE status = 'running')
    ) AS busy
  `;
  return rows[0]?.busy === 1;
});

const ReleaseIndex = Schema.Array(
  Schema.Struct({ tag_name: Schema.String, draft: Schema.optional(Schema.Boolean) }),
);
const decodeReleaseIndex = Schema.decodeUnknownEffect(Schema.fromJsonString(ReleaseIndex));

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    const launcher = yield* ServiceLauncherClient.ServiceLauncherClient;
    const environment = yield* HostProcess.Environment;
    const desktop = config.mode === "desktop" && config.desktopTelemetryControlFd !== undefined;
    const channel = cliReleaseChannelOf(packageJson.version);
    if (
      environment.T3CODE_DISABLE_AUTO_UPDATE?.trim() ||
      channel !== "stable" ||
      (!desktop && !launcher.managed)
    ) {
      return;
    }
    const selfUpdate = yield* ServerSelfUpdate.ServerSelfUpdate;
    const terminals = yield* TerminalManager.TerminalManager;
    const power = yield* HostPowerMonitor.HostPowerMonitor;
    const sql = yield* SqlClient.SqlClient;
    const httpClient = yield* HttpClient.HttpClient;

    const terminalActivity = yield* Ref.make<TerminalActivity>(new Map());
    const unsubscribe = yield* terminals.subscribeMetadata((event) =>
      Ref.update(terminalActivity, (current) => applyTerminalEvent(current, event)),
    );
    yield* Effect.addFinalizer(() => Effect.sync(unsubscribe));

    const busy = Effect.zipWith(
      workInProgress.pipe(
        Effect.provideService(SqlClient.SqlClient, sql),
        Effect.orElseSucceed(() => true),
      ),
      Ref.get(terminalActivity).pipe(Effect.map(terminalsBusy)),
      (work, terminal) => work || terminal,
    );
    const userAway = desktop ? power.snapshot.pipe(Effect.map(userAwayFrom)) : Effect.succeed(true);

    const newestVersion = httpClient
      .execute(
        HttpClientRequest.get(cliReleaseIndexPageUrl(1)).pipe(
          HttpClientRequest.setHeader("Accept", "application/vnd.github+json"),
        ),
      )
      .pipe(
        Effect.flatMap(HttpClientResponse.filterStatusOk),
        Effect.flatMap((response) => response.text),
        Effect.flatMap(decodeReleaseIndex),
        Effect.map((releases) => newestCliReleaseVersion(releases, channel)),
        Effect.timeout(RELEASE_INDEX_TIMEOUT),
        Effect.tapCause((cause) =>
          Effect.logDebug("Could not look up the newest release.", { cause }),
        ),
        Effect.orElseSucceed(() => undefined),
      );

    const installDesktop = (version: string) =>
      selfUpdate.update({ targetVersion: version }).pipe(
        Effect.flatMap((prepared) => {
          const token = prepared.desktopUpdateToken;
          if (token === undefined) return Effect.void;
          return Effect.zipWith(busy, userAway, (working, away) => !working && away).pipe(
            Effect.flatMap((free) =>
              free
                ? selfUpdate.commitDesktopUpdate(token)
                : Effect.logInfo("Work started while the update downloaded; installing later.", {
                    version,
                  }),
            ),
          );
        }),
      );

    const machine: AutoUpdateMachine = {
      currentVersion: packageJson.version,
      newestVersion,
      busy,
      userAway,
      stage: (version) =>
        desktop
          ? Effect.void
          : selfUpdate.update({ targetVersion: version, stageOnly: true }).pipe(Effect.asVoid),
      install: (version) =>
        desktop
          ? installDesktop(version)
          : selfUpdate.update({ targetVersion: version }).pipe(Effect.asVoid),
    };

    yield* forkParked(
      Effect.sleep(STARTUP_DELAY).pipe(
        Effect.andThen(runAutoUpdates(machine)),
        Effect.catchCause((cause) => Effect.logWarning("Automatic updates stopped.", { cause })),
      ),
    );
  }),
);
