import {
  LOCAL_DEVICE_HOST_ID,
  MachineActivityError,
  type MachineActivity as MachineActivitySnapshot,
  type MachineActivityDevice,
  type MachineActivityProcess,
  type MachineActivityStopDeviceInput,
  type ResourceTelemetryProcess,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { windowsPowerShellPath } from "@t3tools/shared/windowsSystem";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";

import * as DeviceService from "../device/DeviceService.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as HostResources from "../resourceTelemetry/HostResources.ts";
import * as ResourceTelemetry from "../resourceTelemetry/ResourceTelemetry.ts";
import {
  PS_ARGS,
  WINDOWS_EMULATOR_SCRIPT,
  deviceUsage,
  findDevices,
  parsePsTable,
  parseWindowsProcessTable,
  type ProcessRow,
} from "./deviceProcesses.ts";

const TOP_PROCESSES = 5;
const PROCESS_TABLE_BYTES = 16 * 1024 * 1024;

export class MachineActivity extends Context.Service<
  MachineActivity,
  {
    readonly snapshot: Effect.Effect<MachineActivitySnapshot>;
    readonly stopDevice: (
      input: MachineActivityStopDeviceInput,
    ) => Effect.Effect<void, MachineActivityError>;
  }
>()("t3/activity/MachineActivity") {}

export function processName(process: ResourceTelemetryProcess, platform: NodeJS.Platform) {
  const executable =
    platform === "linux" ? (/^\S+/.exec(process.command.trim())?.[0].split("/").pop() ?? "") : "";
  return (executable || process.name).replace(/\.exe$/i, "").trim() || "process";
}

function topProcesses(
  processes: ReadonlyArray<ResourceTelemetryProcess>,
  platform: NodeJS.Platform,
  limit = TOP_PROCESSES,
): ReadonlyArray<MachineActivityProcess> {
  const groups = new Map<string, { count: number; cpuPercent: number; memoryBytes: number }>();
  for (const process of processes) {
    const name = processName(process, platform);
    const group = groups.get(name) ?? { count: 0, cpuPercent: 0, memoryBytes: 0 };
    groups.set(name, {
      count: group.count + 1,
      cpuPercent: group.cpuPercent + process.cpuPercent,
      memoryBytes: group.memoryBytes + process.residentBytes,
    });
  }
  return [...groups.entries()]
    .map(([name, group]) => ({ name, ...group }))
    .toSorted((a, b) => b.cpuPercent - a.cpuPercent || b.memoryBytes - a.memoryBytes)
    .slice(0, limit);
}

export const make = Effect.gen(function* () {
  const telemetry = yield* ResourceTelemetry.ResourceTelemetry;
  const hostResources = yield* HostResources.HostResources;
  const devices = yield* DeviceService.DeviceService;
  const runner = yield* ProcessRunner.ProcessRunner;
  const platform = yield* HostProcess.Platform;
  const environment = yield* HostProcess.Environment;
  const lastLook = yield* Ref.make<{
    readonly at: number;
    readonly cpuTimeMs: ReadonlyMap<number, number>;
  }>({ at: 0, cpuTimeMs: new Map() });

  const readRows: Effect.Effect<ReadonlyArray<ProcessRow>> = (
    platform === "win32"
      ? runner
          .run({
            command: "tasklist",
            args: ["/FI", "IMAGENAME eq qemu-system*", "/FO", "CSV", "/NH"],
            timeout: "10 seconds",
          })
          .pipe(
            Effect.flatMap((presence) =>
              /qemu-system/i.test(presence.stdout)
                ? runner
                    .run({
                      command: windowsPowerShellPath(environment),
                      args: ["-NoProfile", "-NonInteractive", "-Command", WINDOWS_EMULATOR_SCRIPT],
                      timeout: "10 seconds",
                      maxOutputBytes: PROCESS_TABLE_BYTES,
                    })
                    .pipe(Effect.map((output) => parseWindowsProcessTable(output.stdout)))
                : Effect.succeed([]),
            ),
          )
      : runner
          .run({
            command: "ps",
            args: PS_ARGS,
            timeout: "5 seconds",
            maxOutputBytes: PROCESS_TABLE_BYTES,
          })
          .pipe(Effect.map((output) => parsePsTable(output.stdout)))
  ).pipe(Effect.orElseSucceed(() => []));

  const deviceNames = devices.state.pipe(
    Effect.map(
      (state) =>
        new Map(
          state.devices
            .filter((device) => device.hostId === LOCAL_DEVICE_HOST_ID)
            .flatMap((device) => [
              [device.id, device.name] as const,
              [device.name, device.name] as const,
            ]),
        ),
    ),
  );

  const readDevices = Effect.gen(function* () {
    const rows = yield* readRows;
    const now = yield* Clock.currentTimeMillis;
    const previous = yield* Ref.get(lastLook);
    const elapsedMs = previous.at === 0 ? 0 : now - previous.at;
    const names = yield* deviceNames;
    const found = findDevices(rows).map((device) => {
      const usage = deviceUsage(rows, device.pid, previous.cpuTimeMs, elapsedMs);
      return {
        device: {
          platform: device.platform,
          id: device.id,
          name:
            names.get(device.id) ??
            (device.platform === "ios" ? "iOS Simulator" : device.id.replaceAll("_", " ")),
          pid: device.pid,
          cpuPercent: usage.cpuPercent,
          memoryBytes: usage.memoryBytes,
        } satisfies MachineActivityDevice,
        pids: usage.pids,
      };
    });
    yield* Ref.set(lastLook, {
      at: now,
      cpuTimeMs: new Map(rows.map((row) => [row.pid, row.cpuTimeMs])),
    });
    return found;
  });

  const snapshot: MachineActivity["Service"]["snapshot"] = Effect.gen(function* () {
    const [tree, resources, found] = yield* Effect.all(
      [
        telemetry.refresh.pipe(Effect.catch(() => telemetry.latest)),
        hostResources.read,
        readDevices,
      ],
      { concurrency: "unbounded" },
    );
    const devicePids = new Set(found.flatMap(({ pids }) => [...pids]));
    const t3Processes = tree.processes.filter((process) => !devicePids.has(process.identity.pid));
    return {
      cpuCount: Math.max(1, resources.cpuCount),
      memoryTotalBytes: resources.totalMemoryBytes,
      t3: {
        cpuPercent: t3Processes.reduce((sum, process) => sum + process.cpuPercent, 0),
        memoryBytes: t3Processes.reduce((sum, process) => sum + process.residentBytes, 0),
      },
      processes: topProcesses(t3Processes, platform),
      devices: found.map(({ device }) => device),
    };
  }).pipe(Effect.withSpan("MachineActivity.snapshot"));

  const terminate = (pid: number) =>
    (platform === "win32"
      ? runner.run({
          command: "taskkill",
          args: ["/PID", String(pid), "/T", "/F"],
          timeout: "15 seconds",
        })
      : runner.run({ command: "kill", args: [String(pid)], timeout: "5 seconds" })
    ).pipe(
      Effect.mapError(
        (cause) =>
          new MachineActivityError({ reason: `Could not stop process ${pid}: ${cause.message}` }),
      ),
      Effect.asVoid,
    );

  const stopDevice: MachineActivity["Service"]["stopDevice"] = Effect.fn(
    "MachineActivity.stopDevice",
  )(function* (input) {
    const running = findDevices(yield* readRows).find(
      (device) =>
        device.pid === input.pid && device.platform === input.platform && device.id === input.id,
    );
    if (!running) {
      return yield* new MachineActivityError({
        reason: "That simulator or emulator is not running anymore.",
      });
    }
    const state = yield* devices.state;
    const known = state.devices.find(
      (device) =>
        device.hostId === LOCAL_DEVICE_HOST_ID &&
        device.platform === input.platform &&
        device.booted &&
        (device.id === input.id || device.name === input.id),
    );
    if (known) {
      const stopped = yield* devices
        .shutdown({ hostId: LOCAL_DEVICE_HOST_ID, deviceId: known.id, platform: input.platform })
        .pipe(
          Effect.as(true),
          Effect.catchCause(() => Effect.succeed(false)),
        );
      if (stopped) return;
    }
    if (input.platform === "ios") {
      const shutdown = yield* runner
        .run({ command: "xcrun", args: ["simctl", "shutdown", input.id], timeout: "60 seconds" })
        .pipe(
          Effect.map((output) => output.code === 0),
          Effect.orElseSucceed(() => false),
        );
      if (shutdown) return;
    }
    yield* terminate(input.pid);
  });

  return MachineActivity.of({ snapshot, stopDevice });
});

export const layer = Layer.effect(MachineActivity, make).pipe(Layer.provide(ProcessRunner.layer));
