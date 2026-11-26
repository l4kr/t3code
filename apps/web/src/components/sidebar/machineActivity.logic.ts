import type { MachineActivity } from "@t3tools/contracts";

export const machineShare = (cpuPercent: number, cpuCount: number) =>
  Math.min(100, Math.round(cpuPercent / Math.max(1, cpuCount)));

export function machineLoad(activity: MachineActivity) {
  const devices = activity.devices.reduce(
    (sum, device) => ({
      cpuPercent: sum.cpuPercent + device.cpuPercent,
      memoryBytes: sum.memoryBytes + device.memoryBytes,
    }),
    { cpuPercent: 0, memoryBytes: 0 },
  );
  return {
    cpuShare: machineShare(activity.t3.cpuPercent + devices.cpuPercent, activity.cpuCount),
    memoryBytes: activity.t3.memoryBytes + devices.memoryBytes,
    deviceCount: activity.devices.length,
  };
}
