import { createMachineActivityEnvironmentAtoms } from "@t3tools/client-runtime/state/machineActivity";

import { connectionAtomRuntime } from "../connection/runtime";

export const machineActivityEnvironment =
  createMachineActivityEnvironmentAtoms(connectionAtomRuntime);
