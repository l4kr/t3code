import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import type { TelemetryOwner } from "./Identify.ts";

// Users name or import their own distros, so only well-known families are reported.
const WSL_DISTRO_FAMILIES = [
  ["ubuntu", "Ubuntu"],
  ["debian", "Debian"],
  ["kali", "Kali"],
  ["opensuse", "openSUSE"],
  ["suse", "SUSE"],
  ["sles", "SUSE"],
  ["oraclelinux", "OracleLinux"],
  ["almalinux", "AlmaLinux"],
  ["rockylinux", "RockyLinux"],
  ["fedora", "Fedora"],
  ["archlinux", "Arch"],
  ["alpine", "Alpine"],
  ["nixos", "NixOS"],
  ["pengwin", "Pengwin"],
  ["docker-desktop", "docker-desktop"],
] as const;

export const wslDistroFamily = (distroName: string): string | undefined => {
  const name = distroName.trim().toLowerCase();
  if (name === "") return undefined;
  return WSL_DISTRO_FAMILIES.find(([prefix]) => name.startsWith(prefix))?.[1] ?? "other";
};

export class AnalyticsService extends Context.Service<
  AnalyticsService,
  {
    /** Whether the event was queued to send; false when telemetry is off. */
    readonly record: (
      event: string,
      properties?: Readonly<Record<string, unknown>>,
      options?: { readonly anonymous?: boolean },
    ) => Effect.Effect<boolean>;

    readonly flush: Effect.Effect<void>;

    readonly recordOwners: (
      owners: ReadonlyArray<TelemetryOwner>,
      observedBy: "server" | "client",
    ) => Effect.Effect<void>;
  }
>()("t3/telemetry/AnalyticsService") {}

export const layer = Layer.succeed(
  AnalyticsService,
  AnalyticsService.of({
    record: Effect.fn("AnalyticsService.record")(() => Effect.succeed(false)),
    flush: Effect.void,
    recordOwners: Effect.fn("AnalyticsService.recordOwners")(() => Effect.void),
  }),
);
