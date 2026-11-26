import type { EnvironmentId, ScopedThreadRef, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { RightPanelSurface, ThreadRightPanelState } from "~/rightPanelStore";

import {
  parseSurfaceWindowSearch,
  redirectWindowedSurface,
  surfaceWindowName,
  surfaceWindowSearch,
  type SurfaceWindowTarget,
} from "./surfaceWindow";

const threadRef: ScopedThreadRef = {
  environmentId: "env-1" as EnvironmentId,
  threadId: "thread-1" as ThreadId,
};
const browser: RightPanelSurface = { id: "browser:tab-1", kind: "preview", resourceId: "tab-1" };
const newBrowser: RightPanelSurface = { id: "browser:new", kind: "preview", resourceId: null };
const terminal: RightPanelSurface = {
  id: "terminal:t",
  kind: "terminal",
  resourceId: "t",
  terminalIds: ["t"],
  activeTerminalId: "t",
};
const device: RightPanelSurface = {
  id: "device:host:iphone",
  kind: "device",
  target: { hostId: "host", deviceId: "iphone", platform: "ios", name: "iPhone 17" },
};
const deviceSetup: RightPanelSurface = { id: "device", kind: "device" };

const panel = (
  isOpen: boolean,
  activeSurfaceId: string | null,
  surfaces: RightPanelSurface[],
): ThreadRightPanelState => ({ isOpen, activeSurfaceId, surfaces });

describe("surface window route", () => {
  it.each<SurfaceWindowTarget>([
    { threadRef, source: { kind: "browser", tabId: "tab-1" } },
    {
      threadRef,
      source: {
        kind: "device",
        hostId: "host",
        deviceId: "iphone",
        platform: "ios",
        name: "iPhone 17",
      },
      background: true,
    },
  ])("round-trips $source.kind windows through the route search", (target) => {
    expect(parseSurfaceWindowSearch(surfaceWindowSearch(target))).toEqual(target);
  });

  it.each([
    {},
    { environmentId: "env-1", threadId: "thread-1", kind: "browser" },
    { environmentId: "env-1", threadId: "thread-1", kind: "device", hostId: "h", deviceId: "d" },
    {
      environmentId: "env-1",
      threadId: "thread-1",
      kind: "device",
      hostId: "h",
      deviceId: "d",
      platform: "web",
      name: "x",
    },
    { environmentId: "env-1", kind: "browser", tabId: "tab-1" },
  ])("rejects an incomplete or unknown search %o", (search) => {
    expect(parseSurfaceWindowSearch(search)).toBeNull();
  });

  it("names one window per thread and surface, so reopening focuses it", () => {
    const tab1 = surfaceWindowName({ threadRef, source: { kind: "browser", tabId: "tab-1" } });
    expect(tab1).toBe(
      surfaceWindowName({
        threadRef,
        source: { kind: "browser", tabId: "tab-1" },
        background: true,
      }),
    );
    expect(tab1).not.toBe(
      surfaceWindowName({ threadRef, source: { kind: "browser", tabId: "tab-2" } }),
    );
    expect(tab1).toMatch(/^t3-surface-[A-Za-z0-9_-]+$/);
  });
});

describe("redirectWindowedSurface", () => {
  it("opens a browser tab in its window and leaves a closed panel closed", () => {
    expect(
      redirectWindowedSurface(panel(false, null, []), panel(true, browser.id, [browser])),
    ).toEqual({
      source: { kind: "browser", tabId: "tab-1" },
      state: panel(false, null, [browser]),
    });
  });

  it("keeps the panel on what it showed when a browser tab is picked from its tabs", () => {
    expect(
      redirectWindowedSurface(
        panel(true, terminal.id, [terminal, browser]),
        panel(true, browser.id, [terminal, browser]),
      ),
    ).toEqual({
      source: { kind: "browser", tabId: "tab-1" },
      state: panel(true, terminal.id, [terminal, browser]),
    });
  });

  it("closes the panel when the address picker it showed became the tab", () => {
    expect(
      redirectWindowedSurface(
        panel(true, newBrowser.id, [newBrowser]),
        panel(true, browser.id, [browser]),
      ),
    ).toEqual({
      source: { kind: "browser", tabId: "tab-1" },
      state: panel(false, null, [browser]),
    });
  });

  it("opens a chosen device in its window", () => {
    expect(
      redirectWindowedSurface(
        panel(true, deviceSetup.id, [deviceSetup]),
        panel(true, device.id, [device]),
      ),
    ).toEqual({
      source: {
        kind: "device",
        hostId: "host",
        deviceId: "iphone",
        platform: "ios",
        name: "iPhone 17",
      },
      state: panel(false, null, [device]),
    });
  });

  it.each([
    ["the address picker", panel(true, newBrowser.id, [newBrowser])],
    ["device setup", panel(true, deviceSetup.id, [deviceSetup])],
    ["a terminal", panel(true, terminal.id, [terminal, browser])],
  ])("leaves %s in the panel", (_name, next) => {
    expect(redirectWindowedSurface(panel(false, null, []), next)).toBeNull();
  });

  it("does nothing while the windowed surface stays inactive or the panel stays closed", () => {
    expect(
      redirectWindowedSurface(
        panel(true, terminal.id, [terminal]),
        panel(true, terminal.id, [terminal, browser]),
      ),
    ).toBeNull();
    expect(redirectWindowedSurface(undefined, panel(false, browser.id, [browser]))).toBeNull();
  });
});
