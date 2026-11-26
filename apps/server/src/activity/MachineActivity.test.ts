import type {
  DeviceServiceState,
  DeviceShutdownInput,
  ResourceTelemetryProcess,
  ResourceTelemetrySnapshot,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";

import * as DeviceService from "../device/DeviceService.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as HostResources from "../resourceTelemetry/HostResources.ts";
import * as ResourceTelemetry from "../resourceTelemetry/ResourceTelemetry.ts";
import * as MachineActivity from "./MachineActivity.ts";

const UDID = "8A1A2FED-25E3-4595-9D23-8EE8C512794A";
const ps = [
  "  100     1   0:10.00  10.0  102400 /Applications/T3 Code.app/Contents/MacOS/T3 Code",
  "  200   100   2:00.00  80.0  409600 rustc --crate-name app",
  "  201   100   2:00.00  70.0  307200 rustc --crate-name core",
  `  300     1   0:30.00   5.0  204800 launchd_sim /Users/q/Library/Developer/CoreSimulator/Devices/${UDID}/data/var/run/launchd_bootstrap.plist`,
  `  301   300   0:10.00  35.0  819200 /Users/q/Library/Developer/CoreSimulator/Devices/${UDID}/data/Containers/Bundle/Application/X/4pass.app/4pass`,
].join("\n");

const process = (pid: number, name: string, cpuPercent: number, residentBytes: number) =>
  ({ identity: { pid }, name, cpuPercent, residentBytes }) as unknown as ResourceTelemetryProcess;

const makeActivity = Effect.fn(function* (shutdownWorks = true) {
  const shutdowns = yield* Ref.make<ReadonlyArray<DeviceShutdownInput>>([]);
  const commands = yield* Ref.make<ReadonlyArray<string>>([]);
  const activity = yield* MachineActivity.make.pipe(
    Effect.provide(
      Layer.mergeAll(
        Layer.mock(ResourceTelemetry.ResourceTelemetry)({
          refresh: Effect.succeed({
            processes: [
              process(100, "T3 Code", 10, 100 * 1024 * 1024),
              process(200, "rustc", 80, 400 * 1024 * 1024),
              process(201, "rustc", 70, 300 * 1024 * 1024),
              process(301, "4pass", 35, 800 * 1024 * 1024),
            ],
          } as unknown as ResourceTelemetrySnapshot),
        }),
        Layer.mock(HostResources.HostResources)({
          read: Effect.succeed({
            sampledAt: 0,
            cpuUtilization: null,
            cpuCount: 10,
            availableMemoryBytes: 0,
            totalMemoryBytes: 16 * 1024 ** 3,
          }),
        }),
        Layer.mock(DeviceService.DeviceService)({
          state: Effect.succeed({
            devices: [
              {
                hostId: "local",
                id: UDID,
                platform: "ios",
                name: "iPhone 17 Pro",
                version: "26.0",
                booted: true,
                physical: false,
              },
            ],
          } as unknown as DeviceServiceState),
          shutdown: (input) =>
            shutdownWorks
              ? Ref.update(shutdowns, (all) => [...all, input])
              : Effect.die("hub unavailable"),
        }),
        Layer.mock(ProcessRunner.ProcessRunner)({
          run: (input) =>
            Ref.update(commands, (all) => [...all, [input.command, ...input.args].join(" ")]).pipe(
              Effect.as({
                stdout: input.command === "ps" ? ps : "",
                stderr: "",
                code: 0 as never,
                timedOut: false,
                stdoutTruncated: false,
                stderrTruncated: false,
                stdoutInvalidUtf8: false,
                stderrInvalidUtf8: false,
              }),
            ),
        }),
      ),
    ),
    Effect.provideService(HostProcess.Platform, "darwin"),
  );
  return { activity, shutdowns, commands };
});

describe("processName", () => {
  const named = (name: string, command: string) =>
    ({ name, command }) as unknown as ResourceTelemetryProcess;

  it("reads a Linux process's name from its command, since the kernel cuts names at 15 characters", () => {
    expect(
      MachineActivity.processName(
        named("t3-resource-mon", "/opt/t3/bin/t3-resource-monitor --root 1"),
        "linux",
      ),
    ).toBe("t3-resource-monitor");
    expect(MachineActivity.processName(named("node-MainThread", "node bin.ts"), "linux")).toBe(
      "node",
    );
    expect(
      MachineActivity.processName(
        named("T3 Code Helper (Renderer)", "/Applications/T3 Code.app/Contents/Frameworks/x"),
        "darwin",
      ),
    ).toBe("T3 Code Helper (Renderer)");
    expect(MachineActivity.processName(named("rustc.exe", "C:\\rust\\rustc.exe"), "win32")).toBe(
      "rustc",
    );
  });
});

describe("MachineActivity", () => {
  it.effect("reports T3 Code's own work apart from the simulators it runs", () =>
    Effect.gen(function* () {
      const { activity } = yield* makeActivity();
      const snapshot = yield* activity.snapshot;
      expect(snapshot.cpuCount).toBe(10);
      expect(snapshot.t3).toEqual({ cpuPercent: 160, memoryBytes: 800 * 1024 * 1024 });
      expect(snapshot.processes[0]).toEqual({
        name: "rustc",
        count: 2,
        cpuPercent: 150,
        memoryBytes: 700 * 1024 * 1024,
      });
      expect(snapshot.devices).toEqual([
        {
          platform: "ios",
          id: UDID,
          name: "iPhone 17 Pro",
          pid: 300,
          cpuPercent: 40,
          memoryBytes: (204800 + 819200) * 1024,
        },
      ]);
    }),
  );

  it.effect("stops a simulator through the device service", () =>
    Effect.gen(function* () {
      const { activity, shutdowns, commands } = yield* makeActivity();
      yield* activity.stopDevice({ platform: "ios", id: UDID, pid: 300 });
      expect(yield* Ref.get(shutdowns)).toEqual([
        { hostId: "local", deviceId: UDID, platform: "ios" },
      ]);
      expect((yield* Ref.get(commands)).some((command) => command.startsWith("kill"))).toBe(false);
    }),
  );

  it.effect("falls back to simctl when the device service cannot stop it", () =>
    Effect.gen(function* () {
      const { activity, commands } = yield* makeActivity(false);
      yield* activity.stopDevice({ platform: "ios", id: UDID, pid: 300 });
      expect(yield* Ref.get(commands)).toContain(`xcrun simctl shutdown ${UDID}`);
    }),
  );

  it.effect("refuses to stop a process that is not a running simulator or emulator", () =>
    Effect.gen(function* () {
      const { activity, shutdowns, commands } = yield* makeActivity();
      const refused = yield* activity
        .stopDevice({ platform: "android", id: "Pixel", pid: 200 })
        .pipe(Effect.flip);
      expect(refused._tag).toBe("MachineActivityError");
      expect(yield* Ref.get(shutdowns)).toEqual([]);
      expect((yield* Ref.get(commands)).some((command) => command.startsWith("kill"))).toBe(false);
    }),
  );
});
