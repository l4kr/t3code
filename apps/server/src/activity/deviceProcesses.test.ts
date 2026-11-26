import { describe, expect, it } from "@effect/vitest";

import {
  cpuPercentSince,
  deviceUsage,
  findDevices,
  parsePsTable,
  parseWindowsProcessTable,
} from "./deviceProcesses.ts";

const macPs = [
  "    1     0  12:01.00   0.3  14000 /sbin/launchd",
  "30871     1   1:21.35   2.5   6016 launchd_sim /Volumes/ssd/CoreSimulator/Devices/8A1A2FED-25E3-4595-9D23-8EE8C512794A/data/var/run/launchd_bootstrap.plist",
  "30900 30871   0:30.00  40.0 524288 /Volumes/ssd/CoreSimulator/Devices/8A1A2FED-25E3-4595-9D23-8EE8C512794A/data/Containers/Bundle/Application/X/4pass.app/4pass",
  "30901 30900   0:01.00   1.0  10240 /usr/libexec/helper",
  "50480     1   1:03.42   0.1   8128 launchd_sim /Users/q/Library/Developer/CoreSimulator/Devices/88D42546-C2F2-4577-B23F-94A7C1F7BF49/data/var/run/launchd_bootstrap.plist",
  "61000     1 1-02:03:04  95.0 2097152 /Users/q/Library/Android/sdk/emulator/qemu/darwin-aarch64/qemu-system-aarch64 -netdelay none -netspeed full -avd Pixel_8_API_35 -port 5554",
  "62000     1   0:00.10   0.0   1024 grep launchd_sim",
].join("\n");

describe("parsePsTable", () => {
  it("reads pid, parent, cumulative CPU time, CPU, memory and command", () => {
    const rows = parsePsTable(macPs);
    expect(rows[1]).toEqual({
      pid: 30871,
      ppid: 1,
      cpuTimeMs: 81_350,
      cpuPercent: 2.5,
      memoryBytes: 6016 * 1024,
      command: expect.stringContaining("launchd_sim /Volumes/ssd"),
    });
    expect(rows.find((row) => row.pid === 61000)?.cpuTimeMs).toBe(
      ((24 + 2) * 3600 + 3 * 60 + 4) * 1000,
    );
  });
});

describe("findDevices", () => {
  it("finds each booted simulator by its UDID and each emulator by its AVD", () => {
    expect(findDevices(parsePsTable(macPs))).toEqual([
      { platform: "ios", id: "8A1A2FED-25E3-4595-9D23-8EE8C512794A", pid: 30871 },
      { platform: "ios", id: "88D42546-C2F2-4577-B23F-94A7C1F7BF49", pid: 50480 },
      { platform: "android", id: "Pixel_8_API_35", pid: 61000 },
    ]);
  });

  it("finds a Windows emulator from its command line", () => {
    const rows = parseWindowsProcessTable(
      [
        '7000\t6000\t120000\t3221225472\t"C:\\Users\\l\\AppData\\Local\\Android\\Sdk\\emulator\\qemu\\windows-x86_64\\qemu-system-x86_64.exe" -avd Medium_Phone_API_35 -no-snapshot-load',
        '7100\t6000\t500\t1048576\t"C:\\Windows\\System32\\conhost.exe"',
      ].join("\r\n"),
    );
    expect(findDevices(rows)).toEqual([
      { platform: "android", id: "Medium_Phone_API_35", pid: 7000 },
    ]);
    expect(rows[0]?.memoryBytes).toBe(3221225472);
    expect(rows[0]?.cpuTimeMs).toBe(120000);
  });
});

describe("deviceUsage", () => {
  it("adds up a simulator's whole process tree", () => {
    const rows = parsePsTable(macPs);
    const usage = deviceUsage(rows, 30871, new Map(), 0);
    expect(usage.memoryBytes).toBe((6016 + 524288 + 10240) * 1024);
    expect(usage.cpuPercent).toBeCloseTo(43.5);
    expect(usage.pids).toEqual(new Set([30871, 30900, 30901]));
  });

  it("measures CPU from the time used since the last look", () => {
    const rows = parsePsTable(macPs);
    const previous = new Map([
      [30871, 81_350 - 100],
      [30900, 30_000 - 1_900],
      [30901, 1_000],
    ]);
    expect(deviceUsage(rows, 30871, previous, 2_000).cpuPercent).toBeCloseTo(100);
  });
});

describe("cpuPercentSince", () => {
  it("is the share of one core used over the interval", () => {
    expect(cpuPercentSince(1_000, 3_000, 2_000)).toBe(100);
    expect(cpuPercentSince(1_000, 1_500, 1_000)).toBe(50);
    expect(cpuPercentSince(undefined, 1_500, 1_000)).toBeUndefined();
    expect(cpuPercentSince(2_000, 1_000, 1_000)).toBeUndefined();
  });
});
