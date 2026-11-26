import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ScopedThreadRef, ThreadId } from "@t3tools/contracts";

import { previewMiniPlayerSourceKey, type PreviewMiniPlayerSource } from "~/previewMiniPlayerStore";
import type { RightPanelSurface, ThreadRightPanelState } from "~/rightPanelStore";

export const SURFACE_WINDOW_PATH = "/surface";

export type SurfaceWindowSource = PreviewMiniPlayerSource;

export interface SurfaceWindowTarget {
  readonly threadRef: ScopedThreadRef;
  readonly source: SurfaceWindowSource;
  readonly background?: true;
}

export type SurfaceWindowSearch = {
  readonly environmentId?: string;
  readonly threadId?: string;
  readonly kind?: string;
  readonly tabId?: string;
  readonly hostId?: string;
  readonly deviceId?: string;
  readonly platform?: string;
  readonly name?: string;
  readonly unfocused?: string;
};

export function surfaceWindowSearch({
  threadRef,
  source,
  background,
}: SurfaceWindowTarget): SurfaceWindowSearch {
  return {
    environmentId: threadRef.environmentId,
    threadId: threadRef.threadId,
    ...(source.kind === "browser"
      ? { kind: "browser", tabId: source.tabId }
      : {
          kind: "device",
          hostId: source.hostId,
          deviceId: source.deviceId,
          platform: source.platform,
          name: source.name,
        }),
    ...(background ? { unfocused: "1" } : {}),
  };
}

const text = (value: unknown): string | null =>
  typeof value === "string" && value !== "" ? value.slice(0, 1024) : null;

function validateSurfaceWindowSearch(raw: Record<string, unknown>): SurfaceWindowSearch {
  const search: Record<string, string> = {};
  for (const key of [
    "environmentId",
    "threadId",
    "kind",
    "tabId",
    "hostId",
    "deviceId",
    "platform",
    "name",
    "unfocused",
  ] as const) {
    const value = text(raw[key]);
    if (value !== null) search[key] = value;
  }
  return search;
}

export function validateSurfaceWindowRouteSearch(raw: Record<string, unknown>): {
  readonly surface?: SurfaceWindowSearch;
} {
  return typeof raw.surface === "object" && raw.surface !== null
    ? { surface: validateSurfaceWindowSearch(raw.surface as Record<string, unknown>) }
    : {};
}

export function parseSurfaceWindowSearch(raw: unknown): SurfaceWindowTarget | null {
  if (typeof raw !== "object" || raw === null) return null;
  const search = validateSurfaceWindowSearch(raw as Record<string, unknown>);
  if (!search.environmentId || !search.threadId) return null;
  const threadRef = {
    environmentId: search.environmentId as EnvironmentId,
    threadId: search.threadId as ThreadId,
  };
  const background = search.unfocused === "1" ? { background: true as const } : {};
  if (search.kind === "browser" && search.tabId) {
    return { threadRef, source: { kind: "browser", tabId: search.tabId }, ...background };
  }
  if (
    search.kind === "device" &&
    search.hostId &&
    search.deviceId &&
    search.name &&
    (search.platform === "ios" || search.platform === "android")
  ) {
    return {
      threadRef,
      source: {
        kind: "device",
        hostId: search.hostId,
        deviceId: search.deviceId,
        platform: search.platform,
        name: search.name,
      },
      ...background,
    };
  }
  return null;
}

export function surfaceWindowKey({ threadRef, source }: Omit<SurfaceWindowTarget, "background">) {
  return `${scopedThreadKey(threadRef)}|${previewMiniPlayerSourceKey(source)}`;
}

export function surfaceWindowName(target: SurfaceWindowTarget): string {
  let hash = 0x811c9dc5;
  for (const char of surfaceWindowKey(target)) {
    hash = Math.imul(hash ^ char.charCodeAt(0), 0x01000193) >>> 0;
  }
  return `t3-surface-${hash.toString(36)}`;
}

function windowableSource(surface: RightPanelSurface): SurfaceWindowSource | null {
  if (surface.kind === "preview") {
    return surface.resourceId === null ? null : { kind: "browser", tabId: surface.resourceId };
  }
  if (surface.kind === "device" && surface.target) {
    return { kind: "device", ...surface.target };
  }
  return null;
}

export function redirectWindowedSurface(
  previous: ThreadRightPanelState | undefined,
  next: ThreadRightPanelState,
): { readonly source: SurfaceWindowSource; readonly state: ThreadRightPanelState } | null {
  if (!next.isOpen || next.activeSurfaceId === null) return null;
  if (previous?.isOpen && previous.activeSurfaceId === next.activeSurfaceId) return null;
  const active = next.surfaces.find((surface) => surface.id === next.activeSurfaceId);
  const source = active ? windowableSource(active) : null;
  if (!source) return null;
  const restored = next.surfaces.find(
    (surface) => surface.id === previous?.activeSurfaceId && windowableSource(surface) === null,
  );
  return {
    source,
    state: {
      ...next,
      isOpen: restored ? (previous?.isOpen ?? false) : false,
      activeSurfaceId: restored?.id ?? null,
    },
  };
}
