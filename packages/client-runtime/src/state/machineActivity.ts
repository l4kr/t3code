import { WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import { createEnvironmentRpcCommand, createEnvironmentRpcQueryAtomFamily } from "./runtime.ts";

const MACHINE_ACTIVITY_REFRESH_MS = 5_000;

export function createMachineActivityEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    snapshot: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:machine-activity",
      tag: WS_METHODS.serverGetMachineActivity,
      staleTimeMs: MACHINE_ACTIVITY_REFRESH_MS - 1_000,
      refreshIntervalMs: MACHINE_ACTIVITY_REFRESH_MS,
    }),
    stopDevice: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:machine-activity:stop-device",
      tag: WS_METHODS.serverStopMachineDevice,
    }),
  };
}
