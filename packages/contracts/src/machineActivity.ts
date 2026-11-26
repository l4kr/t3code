import * as Schema from "effect/Schema";

import { NonNegativeInt, PositiveInt, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { DevicePlatform } from "./device.ts";

export const MachineActivityUsage = Schema.Struct({
  cpuPercent: Schema.Number,
  memoryBytes: NonNegativeInt,
});
export type MachineActivityUsage = typeof MachineActivityUsage.Type;

export const MachineActivityProcess = Schema.Struct({
  ...MachineActivityUsage.fields,
  name: TrimmedNonEmptyString,
  count: PositiveInt,
});
export type MachineActivityProcess = typeof MachineActivityProcess.Type;

export const MachineActivityDevice = Schema.Struct({
  ...MachineActivityUsage.fields,
  platform: DevicePlatform,
  id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  pid: PositiveInt,
});
export type MachineActivityDevice = typeof MachineActivityDevice.Type;

export const MachineActivity = Schema.Struct({
  cpuCount: PositiveInt,
  memoryTotalBytes: NonNegativeInt,
  t3: MachineActivityUsage,
  processes: Schema.Array(MachineActivityProcess),
  devices: Schema.Array(MachineActivityDevice),
});
export type MachineActivity = typeof MachineActivity.Type;

export const MachineActivityStopDeviceInput = Schema.Struct({
  platform: DevicePlatform,
  id: TrimmedNonEmptyString,
  pid: PositiveInt,
});
export type MachineActivityStopDeviceInput = typeof MachineActivityStopDeviceInput.Type;

export class MachineActivityError extends Schema.TaggedError<MachineActivityError>()(
  "MachineActivityError",
  { reason: Schema.String },
) {
  override get message(): string {
    return this.reason;
  }
}
