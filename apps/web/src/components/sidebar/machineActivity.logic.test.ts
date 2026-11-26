import type { MachineActivity } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { machineLoad, machineShare } from "./machineActivity.logic";

const activity: MachineActivity = {
  cpuCount: 8,
  memoryTotalBytes: 32 * 1024 ** 3,
  t3: { cpuPercent: 320, memoryBytes: 4 * 1024 ** 3 },
  processes: [{ name: "rustc", count: 12, cpuPercent: 300, memoryBytes: 3 * 1024 ** 3 }],
  devices: [
    {
      platform: "ios",
      id: "8A1A2FED-25E3-4595-9D23-8EE8C512794A",
      name: "iPhone 17 Pro",
      pid: 300,
      cpuPercent: 80,
      memoryBytes: 1024 ** 3,
    },
  ],
};

describe("machineShare", () => {
  it("is the share of the whole machine, not of one core", () => {
    expect(machineShare(320, 8)).toBe(40);
    expect(machineShare(0.4, 8)).toBe(0);
    expect(machineShare(1600, 8)).toBe(100);
    expect(machineShare(50, 0)).toBe(50);
  });
});

describe("machineLoad", () => {
  it("adds the simulators and emulators to T3 Code's own work", () => {
    expect(machineLoad(activity)).toEqual({
      cpuShare: 50,
      memoryBytes: 5 * 1024 ** 3,
      deviceCount: 1,
    });
  });
});
