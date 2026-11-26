import {
  AuthOrchestrationOperateScope,
  type EnvironmentId,
  type MachineActivity,
  type MachineActivityDevice,
} from "@t3tools/contracts";
import { Smartphone } from "lucide-react";
import { T, useGT } from "gt-react";
import { useState } from "react";

import { formatBytes } from "~/lib/formatBytes";
import { cn } from "~/lib/utils";
import { useEnvironments } from "~/state/environments";
import { machineActivityEnvironment } from "~/state/machineActivity";
import { formatEnvironmentQueryError, useEnvironmentQuery } from "~/state/query";
import { useEnvironmentScope } from "~/state/session";
import { useAtomCommand } from "~/state/use-atom-command";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { machineLoad, machineShare } from "./machineActivity.logic";

export function SidebarMachineActivity() {
  const { environments } = useEnvironments();
  const connected = environments.filter(
    (environment) => environment.connection.phase === "connected",
  );
  if (connected.length === 0) return null;
  return (
    <div className="flex flex-col">
      {connected.map((environment) => (
        <MachineActivityRow
          key={environment.environmentId}
          environmentId={environment.environmentId}
          label={environment.label}
        />
      ))}
    </div>
  );
}

function Usage({
  cpuPercent,
  memoryBytes,
  cpuCount,
}: {
  readonly cpuPercent: number;
  readonly memoryBytes: number;
  readonly cpuCount: number;
}) {
  return (
    <span className="shrink-0 text-muted-foreground tabular-nums">
      {machineShare(cpuPercent, cpuCount)}% · {formatBytes(memoryBytes)}
    </span>
  );
}

function MachineActivityRow({
  environmentId,
  label,
}: {
  readonly environmentId: EnvironmentId;
  readonly label: string;
}) {
  const query = useEnvironmentQuery(
    machineActivityEnvironment.snapshot({ environmentId, input: {} }),
  );
  const activity = query.data;
  if (activity === null) return null;
  const load = machineLoad(activity);
  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type="button"
            className="flex h-6 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-xs text-sidebar-foreground/70 outline-hidden ring-ring hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-inset"
          />
        }
      >
        <span className="min-w-0 flex-1 truncate text-left">{label}</span>
        {load.deviceCount > 0 ? (
          <span className="flex shrink-0 items-center gap-0.5 tabular-nums">
            <Smartphone aria-hidden className="size-3" />
            {load.deviceCount}
          </span>
        ) : null}
        <span className={cn("shrink-0 tabular-nums", load.cpuShare >= 50 && "text-warning")}>
          {load.cpuShare}%
        </span>
        <span className="shrink-0 tabular-nums">{formatBytes(load.memoryBytes)}</span>
      </PopoverTrigger>
      <PopoverPopup side="top" align="start" padding="compact" width="sm">
        <MachineActivityDetails environmentId={environmentId} activity={activity} />
      </PopoverPopup>
    </Popover>
  );
}

function MachineActivityDetails({
  environmentId,
  activity,
}: {
  readonly environmentId: EnvironmentId;
  readonly activity: MachineActivity;
}) {
  const gt = useGT();
  const canStop = useEnvironmentScope(environmentId, AuthOrchestrationOperateScope);
  const stopDevice = useAtomCommand(machineActivityEnvironment.stopDevice, {
    reportFailure: false,
  });
  const [stopping, setStopping] = useState<ReadonlySet<number>>(new Set());
  const [stopError, setStopError] = useState<string | null>(null);

  const stop = async (devices: ReadonlyArray<MachineActivityDevice>) => {
    setStopError(null);
    setStopping((current) => new Set([...current, ...devices.map((device) => device.pid)]));
    const results = await Promise.all(
      devices.map((device) =>
        stopDevice({
          environmentId,
          input: { platform: device.platform, id: device.id, pid: device.pid },
        }).finally(() =>
          setStopping((current) => {
            const next = new Set(current);
            next.delete(device.pid);
            return next;
          }),
        ),
      ),
    );
    const failure = results.find((result) => result._tag === "Failure");
    if (failure?._tag === "Failure") setStopError(formatEnvironmentQueryError(failure.cause));
  };

  return (
    <div className="flex flex-col gap-1 text-xs">
      {activity.processes.map((process) => (
        <div key={process.name} className="flex items-center justify-between gap-3">
          <span className="min-w-0 truncate">
            {process.name}
            {process.count > 1 ? (
              <span className="text-muted-foreground tabular-nums"> ×{process.count}</span>
            ) : null}
          </span>
          <Usage {...process} cpuCount={activity.cpuCount} />
        </div>
      ))}
      {activity.devices.length > 0 ? (
        <div
          className={cn(
            "flex flex-col gap-1",
            activity.processes.length > 0 && "mt-1 border-t pt-1",
          )}
        >
          {activity.devices.map((device) => (
            <div key={device.pid} className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-1.5">
                <Smartphone aria-hidden className="size-3 shrink-0 text-muted-foreground" />
                <span className="truncate">{device.name}</span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <Usage {...device} cpuCount={activity.cpuCount} />
                {canStop ? (
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={stopping.has(device.pid)}
                    onClick={() => void stop([device])}
                  >
                    {gt("Stop", { $context: "verb, powers off a running device" })}
                  </Button>
                ) : null}
              </span>
            </div>
          ))}
          {canStop && activity.devices.length > 1 ? (
            <div className="flex justify-end">
              <Button
                size="xs"
                variant="outline"
                disabled={activity.devices.every((device) => stopping.has(device.pid))}
                onClick={() => void stop(activity.devices)}
              >
                <T>Stop all devices</T>
              </Button>
            </div>
          ) : null}
          {stopError !== null ? (
            <span className="break-words text-destructive">{stopError}</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
